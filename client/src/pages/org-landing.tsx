import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
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
  UserPlus, Trophy, Menu, X, Globe,
} from "lucide-react";
import { SiInstagram, SiFacebook } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { setAuthToken } from "@/lib/authToken";
import { Skeleton } from "@/components/ui/skeleton";
import type { CoachWithUser } from "@/lib/types";

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

  const [coachModalOpen, setCoachModalOpen] = useState(false);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [isSignUp, setIsSignUp] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { toast } = useToast();

  const resetClientForm = () => {
    setEmail("");
    setPassword("");
    setFirstName("");
    setLastName("");
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
        ? { email, password, firstName, lastName, organizationId: org?.id }
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
            {org.athleticEnabled && (
              <a href={`/org/${org.slug}/athletic`}>
                <Button variant="ghost" size="sm" data-testid="link-blhs-athletic">
                  <Trophy className="h-4 w-4 mr-1" />
                  {org.athleticProgramName || "Athletic Scheduling"}
                </Button>
              </a>
            )}
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
          <div className="md:hidden border-t bg-background/95 backdrop-blur-md px-6 py-4 flex flex-col gap-2" data-testid="org-mobile-menu">
            <a href="#features" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start">Features</Button>
            </a>
            {org.athleticEnabled && (
              <a href={`/org/${org.slug}/athletic`} onClick={() => setMobileMenuOpen(false)}>
                <Button variant="ghost" size="sm" className="w-full justify-start" data-testid="link-blhs-athletic-mobile">
                  <Trophy className="h-4 w-4 mr-1" />
                  {org.athleticProgramName || "Athletic Scheduling"}
                </Button>
              </a>
            )}
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

      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
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
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center relative">
          <div className="space-y-6">
            {(org.websiteUrl || org.instagramUrl || org.facebookUrl) && (
              <div className="flex items-center gap-3" data-testid="hero-social-links">
                {org.websiteUrl && (
                  <a
                    href={ensureUrl(org.websiteUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="link-hero-website"
                  >
                    <Globe className="h-4 w-4" />
                  </a>
                )}
                {org.instagramUrl && (
                  <a
                    href={ensureUrl(org.instagramUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="link-hero-instagram"
                  >
                    <SiInstagram className="h-4 w-4" />
                  </a>
                )}
                {org.facebookUrl && (
                  <a
                    href={ensureUrl(org.facebookUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="link-hero-facebook"
                  >
                    <SiFacebook className="h-4 w-4" />
                  </a>
                )}
              </div>
            )}
            <div
              className="inline-flex items-center gap-2 px-3 py-1 rounded-md text-sm font-medium"
              style={
                org.primaryColor
                  ? { backgroundColor: `${org.primaryColor}1a`, color: org.primaryColor }
                  : undefined
              }
            >
              <Zap className="h-3.5 w-3.5" />
              {org.tagline || "Elevate Your Game"}
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight" data-testid="text-org-hero-heading">
              Welcome to{" "}
              <span style={org.primaryColor ? { color: org.primaryColor } : undefined} className={!org.primaryColor ? "text-primary" : ""}>
                {org.name}
              </span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-lg">
              {org.tagline2 || "Book sessions with our expert coaches, manage your training schedule, and take your athletic performance to the next level."}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={() => openClientModal(true)}
                data-testid="button-org-hero-cta"
                style={
                  org.primaryColor
                    ? { backgroundColor: org.primaryColor, borderColor: org.primaryColor }
                    : undefined
                }
              >
                <Calendar className="h-4 w-4 mr-2" />
                Book a Session
              </Button>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground pt-2">
              <span className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5" style={org.primaryColor ? { color: org.primaryColor } : undefined} />
                Free to browse
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" style={org.primaryColor ? { color: org.primaryColor } : undefined} />
                Instant booking
              </span>
            </div>
          </div>

          {org.logoUrl && (
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

      <section id="features" className="py-20 px-6 bg-card/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 space-y-3">
            <h2 className="text-3xl font-bold" data-testid="text-org-features-heading">Everything You Need</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              A complete platform for sports performance and strength & conditioning scheduling.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
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
              <Card key={title} className="p-6 space-y-3 hover-elevate">
                <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {coaches && coaches.length > 0 && (
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12 space-y-3">
              <h2 className="text-3xl font-bold" data-testid="text-org-coaches-heading">Meet Our Coaches</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Train with experienced strength & conditioning professionals dedicated to your athletic development.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-8 max-w-3xl mx-auto">
              {coaches.map((coach: any) => (
                <Card key={coach.id} className="p-6 space-y-4" data-testid={`card-org-coach-${coach.id}`}>
                  <div className="flex items-center gap-4">
                    <Avatar className="h-16 w-16">
                      <AvatarImage src={coach.photoUrl || coach.user?.profileImageUrl || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                        {(coach.user?.firstName?.[0] || "C").toUpperCase()}
                        {(coach.user?.lastName?.[0] || "").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="text-lg font-semibold">
                        {coach.user?.firstName} {coach.user?.lastName}
                      </h3>
                      <p className="text-sm text-muted-foreground">Strength & Conditioning Coach</p>
                    </div>
                  </div>
                  {coach.bio && (
                    <p className="text-sm text-muted-foreground leading-relaxed">{coach.bio}</p>
                  )}
                  {coach.specialties && coach.specialties.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {coach.specialties.map((spec: string) => (
                        <Badge key={spec} variant="secondary" className="text-xs">{spec}</Badge>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
            <div className="text-center mt-8">
              <Button size="lg" onClick={() => openClientModal(true)} data-testid="button-org-coaches-cta">
                <Calendar className="h-4 w-4 mr-2" />
                Sign Up to Book a Session
              </Button>
            </div>
          </div>
        </section>
      )}

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
              {(org.websiteUrl || org.instagramUrl || org.facebookUrl) && (
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
                </div>
              )}
              <a href="/privacy" className="hover:text-foreground transition-colors" data-testid="link-privacy-policy">Privacy Policy</a>
              <a href="/terms" className="hover:text-foreground transition-colors" data-testid="link-terms-conditions">Terms & Conditions</a>
            </div>
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
              <label htmlFor="org-coach-password" className="text-sm font-medium">Password</label>
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
              <label htmlFor="org-client-password" className="text-sm font-medium">Password</label>
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
