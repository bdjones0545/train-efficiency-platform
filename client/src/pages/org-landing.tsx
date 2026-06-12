import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Calendar, Users, Shield, Clock, TrendingUp, Zap, UserCog, LogIn, Eye, EyeOff,
  UserPlus, Trophy, Menu, X, Globe, Mail, ChevronLeft, ChevronRight, Play, Quote, ExternalLink,
  BarChart2, ClipboardList, CalendarCheck, Loader2, FileText,
} from "lucide-react";
import { SiInstagram, SiFacebook, SiYoutube, SiTiktok } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { setAuthToken } from "@/lib/authToken";
import { Skeleton } from "@/components/ui/skeleton";
import type { CoachWithUser } from "@/lib/types";
import {
  FadeUp,
  HeroContent,
  HeroItem,
  StaggerGrid,
  StaggerItem,
  LiftCard,
  AmbientCard,
  PulseBookingDot,
} from "@/components/OrgMotion";

type FocalPoint = "center" | "top" | "bottom" | "left" | "right";

interface OrgMedia {
  id: string;
  mediaType: "image" | "video";
  section: string;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  altText: string | null;
  orderIndex: number;
  isActive: boolean;
  focalPoint?: FocalPoint | null;
}

function focalToObjectPosition(fp?: FocalPoint | null): string {
  switch (fp) {
    case "top": return "center top";
    case "bottom": return "center bottom";
    case "left": return "left center";
    case "right": return "right center";
    default: return "center center";
  }
}

function MediaCarousel({ items }: { items: OrgMedia[] }) {
  const [current, setCurrent] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (items[current]?.mediaType === "video" && videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  }, [current, items]);

  if (items.length === 0) return null;

  const prev = () => setCurrent(i => (i - 1 + items.length) % items.length);
  const next = () => setCurrent(i => (i + 1) % items.length);
  const item = items[current];

  const objPos = focalToObjectPosition(item.focalPoint);

  return (
    <div className="relative w-full h-full" data-testid="hero-media-carousel">
      {item.mediaType === "video" ? (
        <video
          ref={videoRef}
          key={item.url}
          src={item.url}
          className="w-full h-full object-cover"
          style={{ objectPosition: objPos }}
          autoPlay
          muted
          loop
          playsInline
          data-testid="hero-video"
        />
      ) : (
        <img
          src={item.url}
          alt={item.altText || item.caption || "Hero media"}
          className="w-full h-full object-cover"
          style={{ objectPosition: objPos }}
          data-testid="hero-image"
        />
      )}
      {items.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 text-white p-1.5 hover:bg-black/60 transition"
            data-testid="button-carousel-prev"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={next}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 text-white p-1.5 hover:bg-black/60 transition"
            data-testid="button-carousel-next"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`w-1.5 h-1.5 rounded-full transition ${i === current ? "bg-white" : "bg-white/40"}`}
                data-testid={`carousel-dot-${i}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MediaGrid({ items, onOpen }: { items: OrgMedia[]; onOpen: (item: OrgMedia) => void }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory md:grid md:grid-cols-3 md:overflow-visible md:pb-0">
      {items.map(item => (
        <div
          key={item.id}
          className="min-w-[80vw] md:min-w-0 snap-start rounded-lg overflow-hidden cursor-pointer relative group bg-black/5"
          onClick={() => onOpen(item)}
          data-testid={`media-grid-item-${item.id}`}
        >
          <div className="aspect-video">
            {item.mediaType === "image" ? (
              <img
                src={item.url}
                alt={item.altText || item.caption || "Media"}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full bg-black flex items-center justify-center relative">
                <video
                  src={item.url}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition">
                  <div className="rounded-full bg-white/20 p-3">
                    <Play className="h-6 w-6 text-white" />
                  </div>
                </div>
              </div>
            )}
          </div>
          {item.caption && (
            <div className="p-3 bg-card">
              <p className="text-sm text-muted-foreground">{item.caption}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MediaViewer({ item, onClose }: { item: OrgMedia | null; onClose: () => void }) {
  if (!item) return null;
  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden bg-black" data-testid="modal-media-viewer">
        <DialogHeader className="sr-only">
          <DialogTitle>{item.caption || "Media"}</DialogTitle>
        </DialogHeader>
        {item.mediaType === "video" ? (
          <video
            src={item.url}
            className="w-full max-h-[80vh] object-contain"
            controls
            autoPlay
            muted
            playsInline
            data-testid="modal-media-video"
          />
        ) : (
          <img
            src={item.url}
            alt={item.altText || item.caption || "Media"}
            className="w-full max-h-[80vh] object-contain"
            data-testid="modal-media-image"
          />
        )}
        {item.caption && (
          <div className="p-4 bg-black/80">
            <p className="text-sm text-white/80 text-center">{item.caption}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  tagline: string | null;
  tagline2: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  athleticEnabled: boolean | null;
  youtubeUrl: string | null;
  tiktokUrl: string | null;
  linktreeUrl: string | null;
}

function ensureUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export default function OrgLandingPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [, setLocation] = useLocation();

  const { data: org, isLoading: orgLoading, error: orgError } = useQuery<Organization>({
    queryKey: ["/api/organizations", slug],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${slug}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!slug,
  });

  const { data: coaches } = useQuery<CoachWithUser[]>({
    queryKey: ["/api/organizations", slug, "coaches"],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${slug}/coaches`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!slug && !!org,
  });

  const { data: athleticPrograms } = useQuery<any[]>({
    queryKey: ["/api/athletic/programs", org?.id],
    queryFn: async () => {
      const res = await fetch(`/api/athletic/programs?orgId=${org?.id}`);
      return res.json();
    },
    enabled: !!org?.id && org?.athleticEnabled === true,
  });

  const activeAthleticPrograms = athleticPrograms?.filter((p: any) => p.active && (p.type === "scheduling" || !p.type)) || [];
  const activeProgramTools = athleticPrograms?.filter((p: any) => p.active && (p.type === "pr_tracker" || p.type === "workout_builder")) || [];

  const { data: publicLandingPages } = useQuery<any[]>({
    queryKey: ["/api/public/orgs", slug, "landing-pages"],
    queryFn: async () => {
      const res = await fetch(`/api/public/orgs/${slug}/landing-pages`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!slug && !!org,
  });

  const { data: mediaData } = useQuery<{ media: OrgMedia[]; grouped: Record<string, OrgMedia[]> }>({
    queryKey: ["/api/public/org", slug, "media"],
    queryFn: async () => {
      const res = await fetch(`/api/public/org/${slug}/media`);
      if (!res.ok) return { media: [], grouped: {} };
      return res.json();
    },
    enabled: !!slug,
  });

  const heroMedia = (mediaData?.grouped?.["hero"] || []).filter(m => m.isActive);
  const trainingMedia = (mediaData?.grouped?.["training_showcase"] || []).filter(m => m.isActive);
  const facilityMedia = (mediaData?.grouped?.["facility"] || []).filter(m => m.isActive);
  const coachesMedia = (mediaData?.grouped?.["coaches"] || []).filter(m => m.isActive);
  const testimonialsMedia = (mediaData?.grouped?.["testimonials"] || []).filter(m => m.isActive);
  const resultsMedia = (mediaData?.grouped?.["results"] || []).filter(m => m.isActive);

  const [selectedMedia, setSelectedMedia] = useState<OrgMedia | null>(null);
  const [coachModalOpen, setCoachModalOpen] = useState(false);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [isSignUp, setIsSignUp] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navigatingCardId, setNavigatingCardId] = useState<string | null>(null);
  const { toast } = useToast();

  const resetClientForm = () => {
    setEmail("");
    setPassword("");
    setFirstName("");
    setLastName("");
    setPhone("");
    setSmsOptIn(false);
    setError("");
    setShowPassword(false);
  };

  const handleCoachLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/coach/login", { email, password });
      const data = await res.json();
      if (data.success) {
        if (data.token) setAuthToken(data.token);
        toast({ title: "Welcome back!", description: "Redirecting to your dashboard..." });
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        window.location.href = "/coach";
      }
    } catch {
      setError("Invalid email or password");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClientAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const endpoint = isSignUp ? "/api/client/register" : "/api/client/login";
      const body = isSignUp
        ? { email, password, firstName, lastName, organizationId: org?.id, phone: phone.trim() || undefined, smsOptIn }
        : { email, password };
      const res = await apiRequest("POST", endpoint, body);
      const data = await res.json();
      if (data.success) {
        if (data.token) setAuthToken(data.token);
        toast({ title: isSignUp ? "Account created!" : "Welcome back!", description: "Redirecting..." });
        setClientModalOpen(false);
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        window.location.href = "/coaches";
      }
    } catch (err: any) {
      try {
        const msg = await err?.message;
        setError(msg || (isSignUp ? "Registration failed." : "Invalid email or password."));
      } catch {
        setError(isSignUp ? "Registration failed." : "Invalid email or password.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const openClientModal = (signUp: boolean) => {
    setIsSignUp(signUp);
    resetClientForm();
    setClientModalOpen(true);
  };

  if (orgLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="space-y-4 w-full max-w-sm px-6">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-64 mx-auto" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  if (orgError || !org) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Page Not Found</h1>
          <p className="text-muted-foreground">This organization doesn't exist.</p>
          <a href="/">
            <Button data-testid="button-back-home">Back to Home</Button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {org.logoUrl && (
              <img src={org.logoUrl} alt={org.name} className="h-8 rounded-md" data-testid="img-org-nav-logo" />
            )}
            <span className="font-semibold text-lg tracking-tight" data-testid="text-org-brand-name">
              {org.name}
            </span>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <a href="#features">
              <Button variant="ghost" size="sm" data-testid="link-org-features">Features</Button>
            </a>
            {org.athleticEnabled && activeAthleticPrograms.map((p: any) => (
              <Link key={p.id} href={`/org/${org.slug}/athletic/${p.slug}`}>
                <Button variant="ghost" size="sm" data-testid={`link-athletic-${p.id}`}>
                  <CalendarCheck className="h-4 w-4 mr-1" />
                  {p.name}
                </Button>
              </Link>
            ))}
            {org.athleticEnabled && activeProgramTools.map((p: any) => (
              <Link key={p.id} href={`/org/${org.slug}/programs/${p.slug}`}>
                <Button variant="ghost" size="sm" data-testid={`link-program-tool-${p.id}`}>
                  {p.type === "pr_tracker"
                    ? <BarChart2 className="h-4 w-4 mr-1" />
                    : <ClipboardList className="h-4 w-4 mr-1" />}
                  {p.name}
                </Button>
              </Link>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCoachModalOpen(true)}
              data-testid="button-org-coach-login"
            >
              Coach Login
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openClientModal(false)}
              data-testid="button-org-login"
            >
              <LogIn className="h-4 w-4 mr-1" />
              Log In
            </Button>
            <Button
              onClick={() => openClientModal(true)}
              data-testid="button-org-get-started"
            >
              <UserPlus className="h-4 w-4 mr-1" />
              Sign Up
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="button-org-mobile-menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden border-t bg-background/95 backdrop-blur-md px-6 py-4 flex flex-col gap-1.5" data-testid="org-mobile-menu">
            <a href="#features" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start">Features</Button>
            </a>
            {org.athleticEnabled && activeAthleticPrograms.length > 0 && (
              <>
                <p className="px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Scheduling</p>
                {activeAthleticPrograms.map((p: any) => (
                  <Link key={p.id} href={`/org/${org.slug}/athletic/${p.slug}`} onClick={() => setMobileMenuOpen(false)}>
                    <Button variant="ghost" size="sm" className="w-full justify-start" data-testid={`link-athletic-mobile-${p.id}`}>
                      <CalendarCheck className="h-4 w-4 mr-2 text-muted-foreground" />
                      {p.name}
                    </Button>
                  </Link>
                ))}
              </>
            )}
            {org.athleticEnabled && activeProgramTools.length > 0 && (
              <>
                <p className="px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Program Tools</p>
                {activeProgramTools.map((p: any) => (
                  <Link key={p.id} href={`/org/${org.slug}/programs/${p.slug}`} onClick={() => setMobileMenuOpen(false)}>
                    <Button variant="ghost" size="sm" className="w-full justify-start" data-testid={`link-tool-mobile-${p.id}`}>
                      {p.type === "pr_tracker"
                        ? <BarChart2 className="h-4 w-4 mr-2 text-muted-foreground" />
                        : <ClipboardList className="h-4 w-4 mr-2 text-muted-foreground" />}
                      {p.name}
                    </Button>
                  </Link>
                ))}
              </>
            )}
            <div className="h-px bg-border/50 my-1.5" />
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => { setCoachModalOpen(true); setMobileMenuOpen(false); }}
            >
              Coach Login
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => { openClientModal(false); setMobileMenuOpen(false); }}
            >
              <LogIn className="h-4 w-4 mr-1" />
              Log In
            </Button>
            <Button
              className="w-full justify-start"
              onClick={() => { openClientModal(true); setMobileMenuOpen(false); }}
            >
              <UserPlus className="h-4 w-4 mr-1" />
              Sign Up
            </Button>
          </div>
        )}
      </nav>

      <section className="relative pt-20 md:pt-32 pb-12 md:pb-20 px-6 overflow-hidden min-h-[60vh] md:min-h-[80vh] flex items-start md:items-center" data-testid="section-hero">
        {heroMedia.length > 0 ? (
          <>
            <div className="absolute inset-0 pointer-events-none overflow-hidden" data-testid="hero-media-bg">
              <MediaCarousel items={heroMedia} />
            </div>
            <div className="absolute inset-0 bg-black/55 pointer-events-none" />
          </>
        ) : (
          <>
            {/* Animated background grid — subtle, behind all content */}
            <div className="org-hero-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
            {/* Radial fade to keep grid from competing with text */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 30%, hsl(var(--background)) 100%)",
              }}
              aria-hidden="true"
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={
                org.primaryColor
                  ? {
                      background: `linear-gradient(135deg, ${org.primaryColor}14 0%, transparent 50%, ${org.secondaryColor || org.primaryColor}0a 100%)`,
                    }
                  : undefined
              }
            />
            {!org.primaryColor && (
              <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-primary/4 pointer-events-none" />
            )}
          </>
        )}
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center relative w-full">
          <HeroContent className="space-y-6">
            {(org.websiteUrl || org.instagramUrl || org.facebookUrl || org.youtubeUrl || org.tiktokUrl || org.linktreeUrl) && (
              <HeroItem>
              <div className="flex items-center gap-3" data-testid="hero-social-links">
                {org.websiteUrl && (
                  <a href={ensureUrl(org.websiteUrl)} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 text-sm transition-colors ${heroMedia.length > 0 ? "text-white/80 hover:text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid="link-hero-website">
                    <Globe className="h-4 w-4" />
                  </a>
                )}
                {org.instagramUrl && (
                  <a href={ensureUrl(org.instagramUrl)} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 text-sm transition-colors ${heroMedia.length > 0 ? "text-white/80 hover:text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid="link-hero-instagram">
                    <SiInstagram className="h-4 w-4" />
                  </a>
                )}
                {org.facebookUrl && (
                  <a href={ensureUrl(org.facebookUrl)} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 text-sm transition-colors ${heroMedia.length > 0 ? "text-white/80 hover:text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid="link-hero-facebook">
                    <SiFacebook className="h-4 w-4" />
                  </a>
                )}
                {org.youtubeUrl && (
                  <a href={ensureUrl(org.youtubeUrl)} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 text-sm transition-colors ${heroMedia.length > 0 ? "text-white/80 hover:text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid="link-hero-youtube">
                    <SiYoutube className="h-4 w-4" />
                  </a>
                )}
                {org.tiktokUrl && (
                  <a href={ensureUrl(org.tiktokUrl)} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 text-sm transition-colors ${heroMedia.length > 0 ? "text-white/80 hover:text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid="link-hero-tiktok">
                    <SiTiktok className="h-4 w-4" />
                  </a>
                )}
                {org.linktreeUrl && (
                  <a href={ensureUrl(org.linktreeUrl)} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 text-sm transition-colors ${heroMedia.length > 0 ? "text-white/80 hover:text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid="link-hero-linktree">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
              </HeroItem>
            )}
            <HeroItem>
              <div
                className="inline-flex items-center gap-2 px-3 py-1 rounded-md text-sm font-medium"
                style={
                  heroMedia.length > 0
                    ? { backgroundColor: "rgba(255,255,255,0.15)", color: "#fff" }
                    : org.primaryColor
                    ? { backgroundColor: `${org.primaryColor}1a`, color: org.primaryColor }
                    : undefined
                }
              >
                <Zap className="h-3.5 w-3.5" />
                {org.tagline || "Elevate Your Game"}
              </div>
            </HeroItem>
            <HeroItem>
              <h1
                className={`text-4xl sm:text-5xl font-bold tracking-tight leading-tight ${heroMedia.length > 0 ? "text-white" : ""}`}
                data-testid="text-org-hero-heading"
              >
                Welcome to{" "}
                <span
                  style={heroMedia.length > 0 ? undefined : org.primaryColor ? { color: org.primaryColor } : undefined}
                  className={heroMedia.length > 0 ? "text-white" : !org.primaryColor ? "text-primary" : ""}
                >
                  {org.name}
                </span>
              </h1>
            </HeroItem>
            <HeroItem>
              <p className={`text-lg leading-relaxed max-w-lg ${heroMedia.length > 0 ? "text-white/85" : "text-muted-foreground"}`}>
                {org.tagline2 || "Book sessions with our expert coaches, manage your training schedule, and take your athletic performance to the next level."}
              </p>
            </HeroItem>
            <HeroItem>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  onClick={() => openClientModal(true)}
                  data-testid="button-org-hero-cta"
                  className="org-cta-glow"
                  style={
                    heroMedia.length > 0
                      ? { backgroundColor: org.primaryColor || "hsl(var(--primary))", borderColor: org.primaryColor || undefined }
                      : org.primaryColor
                      ? { backgroundColor: org.primaryColor, borderColor: org.primaryColor }
                      : undefined
                  }
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Book a Session
                </Button>
              </div>
            </HeroItem>
            <HeroItem>
              <div className={`flex items-center gap-4 text-sm pt-2 ${heroMedia.length > 0 ? "text-white/70" : "text-muted-foreground"}`}>
                <span className="flex items-center gap-1.5">
                  <PulseBookingDot />
                  Live availability
                </span>
                <span className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" style={heroMedia.length > 0 ? undefined : org.primaryColor ? { color: org.primaryColor } : undefined} />
                  Free to browse
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" style={heroMedia.length > 0 ? undefined : org.primaryColor ? { color: org.primaryColor } : undefined} />
                  Instant booking
                </span>
              </div>
            </HeroItem>
          </HeroContent>

          {org.logoUrl && heroMedia.length === 0 && (
            <div className="relative hidden lg:flex items-center justify-center">
              <div className="relative">
                <div className="absolute -inset-4 bg-primary/10 rounded-md blur-2xl" />
                <img
                  src={org.logoUrl}
                  alt={org.name}
                  className="relative w-80 h-80 object-contain rounded-md"
                  data-testid="img-org-hero-logo"
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {testimonialsMedia.length > 0 && (
        <section className="py-20 px-6 bg-card/40" data-testid="section-testimonials">
          <div className="max-w-6xl mx-auto">
            <FadeUp className="text-center mb-12 space-y-3">
              <h2 className="text-3xl font-bold" data-testid="text-testimonials-heading">Proof From Athletes We've Helped</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Real feedback, real athletes, real performance results.
              </p>
            </FadeUp>
            <StaggerGrid className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {testimonialsMedia.map(item => (
                <LiftCard
                  key={item.id}
                  className="rounded-xl overflow-hidden bg-card border border-border shadow-sm cursor-pointer org-card-hover"
                  onClick={() => setSelectedMedia(item)}
                >
                  <div data-testid={`card-testimonial-${item.id}`}>
                    {item.mediaType === "image" ? (
                      <div className="bg-black flex items-center justify-center" style={{ minHeight: 200 }}>
                        <img
                          src={item.url}
                          alt={item.altText || item.caption || "Testimonial"}
                          className="w-full object-contain"
                          style={{ maxHeight: 320 }}
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="bg-black relative" style={{ minHeight: 200 }}>
                        <video src={item.url} className="w-full object-contain" style={{ maxHeight: 320 }} muted playsInline preload="metadata" />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <div className="rounded-full bg-white/20 p-3">
                            <Play className="h-6 w-6 text-white" />
                          </div>
                        </div>
                      </div>
                    )}
                    {item.caption && (
                      <div className="p-4 flex gap-2 items-start">
                        <Quote className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        <p className="text-sm text-muted-foreground italic leading-relaxed">{item.caption}</p>
                      </div>
                    )}
                  </div>
                </LiftCard>
              ))}
            </StaggerGrid>
          </div>
        </section>
      )}

      <section id="features" className="py-20 px-6 bg-card/50">
        <div className="max-w-6xl mx-auto">
          <FadeUp className="text-center mb-12 space-y-3">
            <h2 className="text-3xl font-bold" data-testid="text-org-features-heading">Everything You Need</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              A complete platform for sports performance and strength & conditioning scheduling.
            </p>
          </FadeUp>

          <StaggerGrid className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Calendar,
                title: "Easy Scheduling",
                description: "Browse coach availability and book sessions in seconds. No phone calls needed.",
              },
              {
                icon: Users,
                title: "Expert Coaches",
                description: "Work with experienced strength & conditioning coaches focused on athletic development.",
              },
              {
                icon: Zap,
                title: "Tailored Programs",
                description: "From speed and agility to max-effort lifting, find the session format that fits your sport.",
              },
              {
                icon: Clock,
                title: "Real-Time Availability",
                description: "See up-to-date schedules and never miss a slot. Instant booking confirmation.",
              },
              {
                icon: Shield,
                title: "Secure & Reliable",
                description: "Your data is protected. Manage your bookings and profile with confidence.",
              },
              {
                icon: TrendingUp,
                title: "Track Progress",
                description: "View your session history and stay on top of your performance journey.",
              },
            ].map(({ icon: Icon, title, description }) => (
              <AmbientCard key={title}>
                <Card className="p-6 space-y-3 h-full border bg-card org-card-hover">
                  <div className="relative z-10 w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="relative z-10 font-semibold">{title}</h3>
                  <p className="relative z-10 text-sm text-muted-foreground leading-relaxed">{description}</p>
                </Card>
              </AmbientCard>
            ))}
          </StaggerGrid>

          {/* Live Programs & Tools */}
          {org.athleticEnabled && (activeAthleticPrograms.length > 0 || activeProgramTools.length > 0) && (
            <div className="mt-16 space-y-8">
              <FadeUp className="text-center space-y-2">
                <h3 className="text-xl font-bold">Available Programs & Tools</h3>
                <p className="text-muted-foreground text-sm max-w-sm mx-auto">Everything active and ready for you at {org.name}.</p>
              </FadeUp>

              {activeAthleticPrograms.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground text-center">Scheduling Programs</p>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl mx-auto">
                    {activeAthleticPrograms.map((p: any) => {
                      const isNav = navigatingCardId === p.id;
                      return (
                        <div
                          key={p.id}
                          role="button"
                          tabIndex={0}
                          data-testid={`link-feature-scheduling-${p.id}`}
                          className="cursor-pointer outline-none"
                          onClick={() => { setNavigatingCardId(p.id); setLocation(`/org/${org.slug}/athletic/${p.slug}`); }}
                          onKeyDown={(e) => e.key === "Enter" && setLocation(`/org/${org.slug}/athletic/${p.slug}`)}
                        >
                          <Card className={`p-5 flex items-start gap-4 hover:border-primary/50 transition-all cursor-pointer group ${isNav ? "opacity-70 scale-[0.98]" : ""}`}>
                            <div className="rounded-lg bg-primary/10 p-2.5 flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                              {isNav
                                ? <Loader2 className="h-5 w-5 text-primary animate-spin" />
                                : <CalendarCheck className="h-5 w-5 text-primary" />}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-sm leading-snug">{p.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {p.trainingTypes?.length > 0 ? p.trainingTypes.join(", ") : "Team scheduling"}
                              </p>
                            </div>
                          </Card>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeProgramTools.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground text-center">Program Tools</p>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl mx-auto">
                    {activeProgramTools.map((p: any) => {
                      const isPr = p.type === "pr_tracker";
                      const isNav = navigatingCardId === p.id;
                      return (
                        <div
                          key={p.id}
                          role="button"
                          tabIndex={0}
                          data-testid={`link-feature-tool-${p.id}`}
                          className="cursor-pointer outline-none"
                          onClick={() => { setNavigatingCardId(p.id); setLocation(`/org/${org.slug}/programs/${p.slug}`); }}
                          onKeyDown={(e) => e.key === "Enter" && setLocation(`/org/${org.slug}/programs/${p.slug}`)}
                        >
                          <Card className={`p-5 flex items-start gap-4 hover:border-primary/50 transition-all cursor-pointer group ${isNav ? "opacity-70 scale-[0.98]" : ""}`}>
                            <div className={`rounded-lg p-2.5 flex-shrink-0 transition-colors ${isPr ? "bg-amber-500/10 group-hover:bg-amber-500/20" : "bg-primary/10 group-hover:bg-primary/20"}`}>
                              {isNav
                                ? <Loader2 className={`h-5 w-5 animate-spin ${isPr ? "text-amber-500" : "text-primary"}`} />
                                : isPr
                                  ? <BarChart2 className="h-5 w-5 text-amber-500" />
                                  : <ClipboardList className="h-5 w-5 text-primary" />}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-sm leading-snug">{p.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {isPr ? "Track personal records" : "View team workouts"}
                              </p>
                            </div>
                          </Card>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Org-Created Landing Pages / Offers */}
          {publicLandingPages && publicLandingPages.length > 0 && (
            <div className="mt-16 space-y-8">
              <FadeUp className="text-center space-y-2">
                <h3 className="text-xl font-bold">Available Offers & Programs</h3>
                <p className="text-muted-foreground text-sm max-w-sm mx-auto">Apply or learn more about current programs offered by {org.name}.</p>
              </FadeUp>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl mx-auto">
                {publicLandingPages.map((page: any) => {
                  const dest = `/apply/${org.slug}/${page.slug}`;
                  const isNav = navigatingCardId === `lp-${page.id}`;
                  return (
                    <div
                      key={page.id}
                      role="button"
                      tabIndex={0}
                      data-testid={`link-landing-page-${page.id}`}
                      className="cursor-pointer outline-none"
                      onClick={() => { setNavigatingCardId(`lp-${page.id}`); setLocation(dest); }}
                      onKeyDown={(e) => e.key === "Enter" && setLocation(dest)}
                    >
                      <Card className={`p-5 flex items-start gap-4 hover:border-primary/50 transition-all cursor-pointer group h-full ${isNav ? "opacity-70 scale-[0.98]" : ""}`}>
                        <div className="rounded-lg bg-primary/10 p-2.5 flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                          {isNav
                            ? <Loader2 className="h-5 w-5 text-primary animate-spin" />
                            : <FileText className="h-5 w-5 text-primary" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm leading-snug">{page.navLabel || page.name}</p>
                          {page.subheadline && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{page.subheadline}</p>
                          )}
                          <p className="text-xs text-primary font-medium mt-2">{page.ctaText || "View Offer"} →</p>
                        </div>
                      </Card>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {coaches && coaches.length > 0 && (
        <section className="py-20 px-6 relative overflow-hidden" data-testid="section-coaches">
          {/* Subtle background contrast */}
          <div className="absolute inset-0 bg-gradient-to-b from-card/20 via-card/40 to-card/20 pointer-events-none" aria-hidden="true" />
          {/* Optional horizontal divider glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2/3 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent pointer-events-none" aria-hidden="true" />

          <div className="max-w-6xl mx-auto relative">
            {/* Section header */}
            <FadeUp className="text-center mb-10 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary/70" data-testid="text-coaches-eyebrow">Coaching Staff</p>
              <h2 className="text-3xl font-bold tracking-tight" data-testid="text-org-coaches-heading">Elite Coaching Team</h2>
              <p className="text-muted-foreground max-w-md mx-auto text-sm">
                Experienced professionals dedicated to athletic performance development.
              </p>
            </FadeUp>

            {/* Mobile: horizontal swipeable carousel / Desktop: responsive grid */}
            <div
              className="
                flex gap-4 overflow-x-auto pb-4
                snap-x snap-mandatory
                md:grid md:grid-cols-2 md:overflow-visible md:pb-0
                lg:grid-cols-3
                scrollbar-none
                -mx-6 px-6
                md:mx-0 md:px-0
              "
              style={{ WebkitOverflowScrolling: "touch" }}
              data-testid="coaches-carousel"
            >
              {coaches.map((coach: any, idx: number) => {
                const firstName = coach.user?.firstName || "C";
                const lastName = coach.user?.lastName || "";
                const initials = `${firstName[0] || ""}${lastName[0] || ""}`.toUpperCase();
                const photoSrc = coach.photoUrl || coach.user?.profileImageUrl || undefined;
                const role = coach.title || coach.role || "Strength & Conditioning Coach";
                const specialty = coach.specialties?.[0] || "";

                return (
                  <div
                    key={coach.id}
                    className="
                      min-w-[82vw] sm:min-w-[60vw]
                      md:min-w-0
                      snap-start
                      flex-shrink-0
                      md:flex-shrink
                    "
                    style={{
                      animationDelay: `${idx * 80}ms`,
                      animation: "coaches-fade-in 0.45s ease both",
                    }}
                    data-testid={`card-org-coach-${coach.id}`}
                  >
                    {/* Glass card */}
                    <div
                      className="
                        relative rounded-2xl border border-white/8
                        bg-card/60 backdrop-blur-sm
                        p-4 h-full
                        shadow-sm
                        transition-all duration-200
                        hover:scale-[1.015] hover:shadow-md
                        active:scale-[0.99]
                        group
                        overflow-hidden
                      "
                      style={{
                        boxShadow: "0 0 0 1px rgba(var(--primary-rgb, 74 222 128), 0.08), 0 4px 16px rgba(0,0,0,0.10)",
                      }}
                    >
                      {/* Subtle green edge glow on hover */}
                      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                        style={{ boxShadow: "inset 0 0 0 1px rgba(var(--primary-rgb, 74 222 128), 0.18)" }}
                        aria-hidden="true"
                      />

                      {/* Horizontal layout: avatar + info */}
                      <div className="flex items-center gap-3.5">
                        {/* Premium avatar */}
                        <div className="relative flex-shrink-0">
                          {/* Soft glow ring */}
                          <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-primary/30 to-primary/5 blur-[2px]" aria-hidden="true" />
                          <div className="relative w-14 h-14 rounded-full overflow-hidden ring-1 ring-primary/20">
                            {photoSrc ? (
                              <img
                                src={photoSrc}
                                alt={`${firstName} ${lastName}`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              /* EST/neural-inspired gradient fallback */
                              <div
                                className="w-full h-full flex items-center justify-center relative"
                                style={{
                                  background: "linear-gradient(135deg, hsl(var(--primary)/0.25) 0%, hsl(var(--primary)/0.08) 50%, hsl(240 20% 12%) 100%)",
                                }}
                              >
                                {/* Subtle grid texture */}
                                <div
                                  className="absolute inset-0 opacity-20"
                                  style={{
                                    backgroundImage: "linear-gradient(hsl(var(--primary)/0.3) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)/0.3) 1px, transparent 1px)",
                                    backgroundSize: "8px 8px",
                                  }}
                                  aria-hidden="true"
                                />
                                <span className="relative text-base font-bold text-primary/90 tracking-wide select-none">
                                  {initials || "?"}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Name + role + primary specialty */}
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-[15px] leading-tight tracking-tight truncate">
                            {firstName} {lastName}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{role}</p>
                          {specialty && (
                            <p className="text-xs text-primary/70 font-medium mt-0.5 truncate">{specialty}</p>
                          )}
                        </div>
                      </div>

                      {/* Specialty pills */}
                      {coach.specialties && coach.specialties.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {coach.specialties.slice(0, 4).map((spec: string) => (
                            <span
                              key={spec}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/8 text-primary/80 border border-primary/12"
                            >
                              {spec}
                            </span>
                          ))}
                          {coach.specialties.length > 4 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
                              +{coach.specialties.length - 4}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* CTA — connected to section */}
            <FadeUp className="mt-14 text-center relative">
              {/* Subtle glow behind CTA */}
              <div className="absolute inset-0 pointer-events-none" aria-hidden="true"
                style={{ background: "radial-gradient(ellipse 60% 80% at 50% 50%, hsl(var(--primary)/0.06) 0%, transparent 70%)" }}
              />
              <div className="relative space-y-3">
                <h3 className="text-xl font-bold tracking-tight">Ready to Start Training?</h3>
                <p className="text-sm text-muted-foreground">
                  Book your first session with the EST coaching staff.
                </p>
                <div className="pt-2">
                  <Button
                    size="lg"
                    onClick={() => openClientModal(true)}
                    data-testid="button-org-coaches-cta"
                    className="org-cta-glow"
                  >
                    <Calendar className="h-4 w-4 mr-2" />
                    Sign Up to Book a Session
                  </Button>
                </div>
              </div>
            </FadeUp>
          </div>

          {/* Animation keyframes */}
          <style>{`
            @keyframes coaches-fade-in {
              from { opacity: 0; transform: translateY(12px); }
              to   { opacity: 1; transform: translateY(0); }
            }
            .scrollbar-none { scrollbar-width: none; }
            .scrollbar-none::-webkit-scrollbar { display: none; }
          `}</style>
        </section>
      )}

      {trainingMedia.length > 0 && (
        <section className="py-20 px-6 bg-card/30" data-testid="section-training-showcase">
          <div className="max-w-6xl mx-auto">
            <FadeUp className="text-center mb-12 space-y-3">
              <h2 className="text-3xl font-bold" data-testid="text-training-heading">How We Train</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                See our training philosophy in action.
              </p>
            </FadeUp>
            <FadeUp delay={0.1}>
              <MediaGrid items={trainingMedia} onOpen={setSelectedMedia} />
            </FadeUp>
          </div>
        </section>
      )}

      {facilityMedia.length > 0 && (
        <section className="py-20 px-6" data-testid="section-facility">
          <div className="max-w-6xl mx-auto">
            <FadeUp className="text-center mb-12 space-y-3">
              <h2 className="text-3xl font-bold" data-testid="text-facility-heading">Where You'll Train</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                A facility built for performance. Come see what we've built for you.
              </p>
            </FadeUp>
            <FadeUp delay={0.1}>
              <MediaGrid items={facilityMedia} onOpen={setSelectedMedia} />
            </FadeUp>
          </div>
        </section>
      )}

      {coachesMedia.length > 0 && (
        <section className="py-20 px-6 bg-card/30" data-testid="section-coaches-media">
          <div className="max-w-6xl mx-auto">
            <FadeUp className="text-center mb-12 space-y-3">
              <h2 className="text-3xl font-bold" data-testid="text-coaches-media-heading">Our Coaching Team</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                The people behind your progress.
              </p>
            </FadeUp>
            <FadeUp delay={0.1}>
              <MediaGrid items={coachesMedia} onOpen={setSelectedMedia} />
            </FadeUp>
          </div>
        </section>
      )}

      {resultsMedia.length > 0 && (
        <section className="py-20 px-6 bg-card/30" data-testid="section-results">
          <div className="max-w-6xl mx-auto">
            <FadeUp className="text-center mb-12 space-y-3">
              <h2 className="text-3xl font-bold" data-testid="text-results-heading">Athlete Highlights</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Client results and success stories.
              </p>
            </FadeUp>
            <FadeUp delay={0.1}>
              <MediaGrid items={resultsMedia} onOpen={setSelectedMedia} />
            </FadeUp>
          </div>
        </section>
      )}

      <MediaViewer item={selectedMedia} onClose={() => setSelectedMedia(null)} />

      <footer className="py-8 px-6 border-t">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              {org.logoUrl && (
                <img src={org.logoUrl} alt={org.name} className="h-5 rounded-sm" data-testid="img-org-footer-logo" />
              )}
              <span>{org.name}</span>
            </div>
            <div className="flex items-center gap-4">
              {(org.websiteUrl || org.instagramUrl || org.facebookUrl || org.youtubeUrl || org.tiktokUrl || org.linktreeUrl) && (
                <div className="flex items-center gap-3">
                  {org.websiteUrl && (
                    <a href={ensureUrl(org.websiteUrl)} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors" data-testid="link-org-website">
                      <Globe className="h-4 w-4" />
                    </a>
                  )}
                  {org.instagramUrl && (
                    <a href={ensureUrl(org.instagramUrl)} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors" data-testid="link-org-instagram">
                      <SiInstagram className="h-4 w-4" />
                    </a>
                  )}
                  {org.facebookUrl && (
                    <a href={ensureUrl(org.facebookUrl)} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors" data-testid="link-org-facebook">
                      <SiFacebook className="h-4 w-4" />
                    </a>
                  )}
                  {org.youtubeUrl && (
                    <a href={ensureUrl(org.youtubeUrl)} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors" data-testid="link-org-youtube">
                      <SiYoutube className="h-4 w-4" />
                    </a>
                  )}
                  {org.tiktokUrl && (
                    <a href={ensureUrl(org.tiktokUrl)} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors" data-testid="link-org-tiktok">
                      <SiTiktok className="h-4 w-4" />
                    </a>
                  )}
                  {org.linktreeUrl && (
                    <a href={ensureUrl(org.linktreeUrl)} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors" data-testid="link-org-linktree">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              )}
              <a href="/privacy" className="hover:text-foreground transition-colors" data-testid="link-privacy-policy">Privacy Policy</a>
              <a href="/terms" className="hover:text-foreground transition-colors" data-testid="link-terms-conditions">Terms & Conditions</a>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Mail className="h-4 w-4" />
            <span>Contact Support:</span>
            <a href="mailto:Bryan.jones@efficiencystrengthtraining.com" className="hover:text-foreground transition-colors underline" data-testid="link-contact-support">Bryan.jones@efficiencystrengthtraining.com</a>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} {org.name}. All rights reserved.</p>
            <span className="opacity-50">Powered by Train Efficiency</span>
          </div>
        </div>
      </footer>

      <Dialog open={coachModalOpen} onOpenChange={(open) => {
        setCoachModalOpen(open);
        if (!open) { setEmail(""); setPassword(""); setError(""); setShowPassword(false); }
      }}>
        <DialogContent className="sm:max-w-md" data-testid="modal-org-coach-login">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5 text-primary" />
              Coach Sign In
            </DialogTitle>
            <DialogDescription>
              Sign in to access your coaching dashboard and manage your sessions.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCoachLogin} className="space-y-4 pt-2">
            <div className="space-y-2">
              <label htmlFor="org-coach-email" className="text-sm font-medium">Email</label>
              <Input
                id="org-coach-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                required
                data-testid="input-org-coach-email"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="org-coach-password" className="text-sm font-medium">Password</label>
                <a
                  href="/forgot-password"
                  className="text-sm text-primary hover:underline underline-offset-4"
                  data-testid="link-org-coach-forgot-password"
                >
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <Input
                  id="org-coach-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  required
                  className="pr-10"
                  data-testid="input-org-coach-password"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute right-0 top-0"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive" data-testid="text-org-login-error">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isLoading || !email || !password}
              data-testid="button-org-coach-login-submit"
            >
              <LogIn className="h-4 w-4 mr-2" />
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={clientModalOpen} onOpenChange={(open) => {
        setClientModalOpen(open);
        if (!open) resetClientForm();
      }}>
        <DialogContent className="sm:max-w-md" data-testid="modal-org-client-auth">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isSignUp ? <UserPlus className="h-5 w-5 text-primary" /> : <LogIn className="h-5 w-5 text-primary" />}
              {isSignUp ? "Create Account" : "Welcome Back"}
            </DialogTitle>
            <DialogDescription>
              {isSignUp
                ? `Sign up to book sessions with ${org.name}.`
                : "Log in to your account to view and manage your bookings."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleClientAuth} className="space-y-4 pt-2">
            {isSignUp && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label htmlFor="org-client-first" className="text-sm font-medium">First Name</label>
                  <Input
                    id="org-client-first"
                    placeholder="First name"
                    value={firstName}
                    onChange={(e) => { setFirstName(e.target.value); setError(""); }}
                    required
                    data-testid="input-org-client-first-name"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="org-client-last" className="text-sm font-medium">Last Name</label>
                  <Input
                    id="org-client-last"
                    placeholder="Last name"
                    value={lastName}
                    onChange={(e) => { setLastName(e.target.value); setError(""); }}
                    required
                    data-testid="input-org-client-last-name"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor="org-client-email" className="text-sm font-medium">Email</label>
              <Input
                id="org-client-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                required
                data-testid="input-org-client-email"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="org-client-password" className="text-sm font-medium">Password</label>
                {!isSignUp && (
                  <a
                    href="/forgot-password"
                    className="text-sm text-primary hover:underline underline-offset-4"
                    data-testid="link-org-client-forgot-password"
                  >
                    Forgot password?
                  </a>
                )}
              </div>
              <div className="relative">
                <Input
                  id="org-client-password"
                  type={showPassword ? "text" : "password"}
                  placeholder={isSignUp ? "Create a password (6+ characters)" : "Enter your password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  required
                  minLength={6}
                  className="pr-10"
                  data-testid="input-org-client-password"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute right-0 top-0"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {isSignUp && (
              <>
                <div className="space-y-2">
                  <label htmlFor="org-client-phone" className="text-sm font-medium">Phone Number <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <Input
                    id="org-client-phone"
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    value={phone}
                    onChange={(e) => { setPhone(e.target.value); setError(""); }}
                    data-testid="input-org-client-phone"
                  />
                  <p className="text-xs text-muted-foreground">Used for booking reminders and optional SMS notifications.</p>
                </div>
                {phone.trim() && (
                  <div className="flex items-start gap-2.5 p-3 rounded-md border bg-muted/30">
                    <input
                      type="checkbox"
                      id="org-sms-consent"
                      checked={smsOptIn}
                      onChange={(e) => setSmsOptIn(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 cursor-pointer"
                      data-testid="checkbox-org-sms-consent"
                    />
                    <label htmlFor="org-sms-consent" className="text-xs text-muted-foreground cursor-pointer leading-relaxed">
                      I agree to receive SMS notifications from my coach or organization. Message and data rates may apply. I can opt out at any time.
                    </label>
                  </div>
                )}
              </>
            )}
            {error && <p className="text-sm text-destructive" data-testid="text-org-client-auth-error">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isLoading || !email || !password || (isSignUp && (!firstName || !lastName))}
              data-testid="button-org-client-auth-submit"
            >
              {isSignUp ? <UserPlus className="h-4 w-4 mr-2" /> : <LogIn className="h-4 w-4 mr-2" />}
              {isLoading ? (isSignUp ? "Creating account..." : "Signing in...") : (isSignUp ? "Create Account" : "Log In")}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {isSignUp ? (
                <>Already have an account?{" "}
                  <button
                    type="button"
                    className="text-primary underline-offset-4 hover:underline"
                    onClick={() => { setIsSignUp(false); setError(""); }}
                    data-testid="button-org-switch-to-login"
                  >
                    Log in
                  </button>
                </>
              ) : (
                <>Don't have an account?{" "}
                  <button
                    type="button"
                    className="text-primary underline-offset-4 hover:underline"
                    onClick={() => { setIsSignUp(true); setError(""); }}
                    data-testid="button-org-switch-to-signup"
                  >
                    Sign up
                  </button>
                </>
              )}
            </p>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
