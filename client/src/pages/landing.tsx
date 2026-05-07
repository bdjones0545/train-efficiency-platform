import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Calendar, Users, Shield, Clock, TrendingUp, Zap, UserCog, LogIn, Eye, EyeOff,
  UserPlus, Menu, X, DollarSign, CreditCard, BarChart3, Mail, Dumbbell,
  ClipboardList, UserCheck, Wallet, Receipt, Building2, CheckCircle2, ArrowRight, Sparkles,
  ChevronRight, Star, Lock, Globe, Activity, Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { setAuthToken } from "@/lib/authToken";
import HeroDashboard from "@/components/HeroDashboard";

export default function LandingPage() {
  const [coachModalOpen, setCoachModalOpen] = useState(false);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { toast } = useToast();

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setFirstName("");
    setLastName("");
    setBusinessName("");
    setSlug("");
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
    } catch (err: any) {
      setError("Invalid email or password");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/organizations/register", {
        businessName, slug, email, password, firstName, lastName,
      });
      const data = await res.json();
      if (data.success) {
        if (data.token) setAuthToken(data.token);
        toast({
          title: "Business registered!",
          description: `Your platform is live at /org/${data.organization.slug}`,
        });
        setRegisterModalOpen(false);
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        window.location.href = "/admin/setup";
      }
    } catch (err: any) {
      try {
        const msg = await err?.message;
        setError(msg || "Registration failed. Please try again.");
      } catch {
        setError("Registration failed. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const openRegisterModal = () => {
    resetForm();
    setRegisterModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ── NAV ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-background/85 border-b border-border/60">
        <div className="max-w-6xl mx-auto px-5 h-15 flex items-center justify-between gap-4" style={{ height: "60px" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
              <Dumbbell className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm tracking-tight" data-testid="text-brand-name">
              TrainEfficiency
            </span>
          </div>
          <div className="hidden md:flex items-center gap-1">
            <a href="#built-for-coaches">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground text-xs" data-testid="link-features">Why Coaches Use It</Button>
            </a>
            <a href="#features">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground text-xs" data-testid="link-platform">Platform</Button>
            </a>
            <a href="#pricing">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground text-xs" data-testid="link-pricing">Pricing</Button>
            </a>
            <a href="/portal">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground text-xs" data-testid="link-client-portal">Client Portal</Button>
            </a>
            <div className="w-px h-4 bg-border/60 mx-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCoachModalOpen(true)}
              className="text-xs"
              data-testid="button-coach-login"
            >
              <LogIn className="h-3.5 w-3.5 mr-1.5" />
              Sign In
            </Button>
            <Button
              size="sm"
              onClick={() => openRegisterModal()}
              className="text-xs"
              data-testid="button-get-started"
            >
              Start Free Trial
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden h-8 w-8"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="button-mobile-menu"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border/60 bg-background/97 backdrop-blur-md px-5 py-4 flex flex-col gap-1.5" data-testid="mobile-menu">
            <a href="#built-for-coaches" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start text-sm" data-testid="link-features-mobile">Why Coaches Use It</Button>
            </a>
            <a href="#features" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start text-sm" data-testid="link-how-it-works-mobile">Platform</Button>
            </a>
            <a href="#pricing" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start text-sm" data-testid="link-pricing-mobile">Pricing</Button>
            </a>
            <a href="/portal" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start text-sm" data-testid="link-client-portal-mobile">Client Portal</Button>
            </a>
            <div className="h-px bg-border/60 my-1" />
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-sm"
              onClick={() => { setCoachModalOpen(true); setMobileMenuOpen(false); }}
              data-testid="button-coach-login-mobile"
            >
              <LogIn className="h-4 w-4 mr-2" />
              Coach Sign In
            </Button>
            <Button
              size="sm"
              className="w-full justify-start text-sm"
              onClick={() => { openRegisterModal(); setMobileMenuOpen(false); }}
              data-testid="button-get-started-mobile"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Start Free Trial
            </Button>
          </div>
        )}
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-28 pb-20 px-5 overflow-hidden">
        {/* Subtle radial glow */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-primary/6 rounded-full blur-3xl" />
        </div>

        <div className="max-w-5xl mx-auto relative">
          {/* Eyebrow */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/25 bg-primary/8 text-xs font-medium text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Built for strength & conditioning coaches
            </div>
          </div>

          {/* Headline */}
          <div className="text-center space-y-5 max-w-3xl mx-auto">
            <h1 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-bold tracking-tight leading-[1.1]" data-testid="text-hero-heading">
              Stop Using Studio Software.<br />
              <span className="text-primary">Start Using Coaching Software.</span>
            </h1>
            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto">
              TrainEfficiency is the operational platform purpose-built for S&C coaches — scheduling, session payouts, team contracts, client wallets, and coach management in one place.
            </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-8">
            <Button
              size="lg"
              onClick={() => openRegisterModal()}
              className="w-full sm:w-auto px-7 h-11 text-sm font-medium"
              data-testid="button-hero-cta"
            >
              Start Free 3-Day Trial
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => setCoachModalOpen(true)}
              className="w-full sm:w-auto px-7 h-11 text-sm"
              data-testid="button-hero-login"
            >
              <LogIn className="h-4 w-4 mr-2" />
              Coach Sign In
            </Button>
          </div>

          {/* Trust micro-signals */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground pt-6">
            {["3-day free trial", "No credit card required", "Your own branded platform", "Set up in minutes"].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                {t}
              </span>
            ))}
          </div>

          {/* Dashboard Mockup */}
          <div className="mt-14 relative" data-testid="img-dashboard-mockup">
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none rounded-b-xl" />
            <HeroDashboard />
          </div>
        </div>
      </section>

      {/* ── TRUST & AUTHORITY ── */}
      <section id="built-for-coaches" className="py-16 px-5 border-y border-border/60">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10 space-y-3">
            <p className="text-xs font-semibold text-primary uppercase tracking-widest">Built Different</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-problem-heading">
              Generic fitness software doesn't understand<br className="hidden sm:block" /> how coaching businesses actually run
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto text-sm leading-relaxed">
              Studio apps are built for yoga classes and group fitness. TrainEfficiency was built by a working S&C coach — designed around the exact workflows you deal with every single day.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: Receipt,
                label: "Session-by-session payouts",
                detail: "Mark a session complete, see exactly what you're owed. No spreadsheets, no guessing.",
              },
              {
                icon: Users,
                label: "Semi-private scheduling",
                detail: "Set capacity limits, age ranges, and skill levels for group sessions. Clients grab open spots.",
              },
              {
                icon: Building2,
                label: "Team training contracts",
                detail: "Quote a school or program, set per-athlete pricing, and bill monthly through Stripe automatically.",
              },
              {
                icon: Clock,
                label: "Recurring schedule management",
                detail: "Clone sessions by day or week. Build out months of programming in seconds.",
              },
              {
                icon: UserCog,
                label: "Multi-coach operations",
                detail: "Add coaches, assign sessions, track individual earnings and payout history.",
              },
              {
                icon: Wallet,
                label: "Client wallet system",
                detail: "Clients prepay for session credits. Balances are tracked automatically. No cash, no Venmo.",
              },
            ].map(({ icon: Icon, label, detail }) => (
              <div
                key={label}
                className="flex gap-3.5 p-4 rounded-lg border border-border/60 bg-card/60 hover:border-primary/30 hover:bg-card transition-all duration-200"
                data-testid={`card-trust-${label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-semibold leading-snug">{label}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{detail}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Founder note */}
          <div className="mt-8 p-5 rounded-xl border border-border/60 bg-card/50 flex gap-4 items-start max-w-2xl mx-auto">
            <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Dumbbell className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm leading-relaxed text-muted-foreground italic">
                "I built this because I was managing clients through Google Sheets, collecting payments through Venmo, and sending invoices manually. Every other tool I tried was built for pilates studios. So I built what I actually needed."
              </p>
              <p className="text-sm font-semibold mt-2">Bryan Jones — S&C Coach & Founder, TrainEfficiency</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── PLATFORM FEATURES ── */}
      <section id="features" className="py-20 px-5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14 space-y-3">
            <p className="text-xs font-semibold text-primary uppercase tracking-widest">The Platform</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-features-heading">
              Every system your coaching business needs
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto text-sm">
              From booking your first private client to running a full team program — it's all here.
            </p>
          </div>

          {/* Feature Category: Scheduling */}
          <div className="space-y-12">
            {[
              {
                category: "Scheduling & Operations",
                icon: Calendar,
                tagline: "Built for Back-to-Back Coaching Days",
                features: [
                  { icon: Calendar, title: "Set your schedule, let clients book", description: "Configure availability by day, time, and location. Clients book directly from open slots — no back-and-forth texts." },
                  { icon: Clock, title: "Clone sessions in seconds", description: "Repeat sessions daily, weekly, or on specific days. Build out your entire recurring schedule without manual entry." },
                  { icon: UserCheck, title: "Multi-location support", description: "Manage sessions across different training sites. Clients always know exactly where to show up." },
                ],
              },
              {
                category: "Payments & Payouts",
                icon: DollarSign,
                tagline: "Know Exactly What Your Coaching Business Earns",
                features: [
                  { icon: CreditCard, title: "Stripe built in, money goes to you", description: "Accept session packages, team invoices, and wallet top-ups — all through your own Stripe account." },
                  { icon: Wallet, title: "Client wallets & session credits", description: "Clients prepay, balances are tracked automatically. No cash, no Venmo. Just credits that get redeemed at sessions." },
                  { icon: Receipt, title: "Session redemptions & payout requests", description: "Mark a session complete, see exactly what you're owed, and request a payout. Full transparency on every dollar." },
                ],
              },
              {
                category: "Team Training Infrastructure",
                icon: Building2,
                tagline: "Win School & Program Contracts Systematically",
                features: [
                  { icon: Building2, title: "Team contracts with per-athlete pricing", description: "Generate quotes, set per-athlete rates, multi-month invoicing. Everything automated through Stripe." },
                  { icon: Users, title: "Semi-private session management", description: "Run group training with configurable capacity, age ranges, and skill levels. Clients sign up for open spots." },
                  { icon: TrendingUp, title: "Scale from solo to full team", description: "Start with private 1-on-1s. Add semi-privates. Land a team contract. The platform grows with you." },
                ],
              },
              {
                category: "Coach & Client Management",
                icon: UserCog,
                tagline: "Run Your Business, Not Just Your Sessions",
                features: [
                  { icon: UserCog, title: "Multi-coach operations", description: "Add coaches, assign sessions, and track individual payout histories — all from one admin dashboard." },
                  { icon: ClipboardList, title: "Full client roster", description: "View booking history, session credits, contact details, and wallet balances for every client in one place." },
                  { icon: Shield, title: "Role-based access", description: "Coaches, clients, and admins each see exactly what they need. Permissions are automatic and air-tight." },
                ],
              },
              {
                category: "Your Brand, Not Ours",
                icon: Globe,
                tagline: "Clients See Your Business — Not Generic Software",
                features: [
                  { icon: Sparkles, title: "Custom branded landing page", description: "Your own URL, your logo, your colors, your tagline. Clients sign up directly from your branded page." },
                  { icon: Mail, title: "Automated email notifications", description: "Booking confirmations, payment receipts, team invoices, and reminders sent automatically under your brand." },
                  { icon: BarChart3, title: "Business analytics & revenue goals", description: "Set monthly targets, track sessions completed, monitor earnings. See your business at a real glance." },
                ],
              },
            ].map(({ category, icon: CatIcon, tagline, features }) => (
              <div key={category} className="space-y-5" data-testid={`section-${category.toLowerCase().replace(/\s+/g, '-')}`}>
                <div className="flex items-start gap-3 pb-3 border-b border-border/60">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <CatIcon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-0.5">{category}</p>
                    <h3 className="text-lg font-bold tracking-tight">{tagline}</h3>
                  </div>
                </div>
                <div className="grid sm:grid-cols-3 gap-4">
                  {features.map(({ icon: Icon, title, description }) => (
                    <div
                      key={title}
                      className="p-4 rounded-lg border border-border/50 bg-card/60 hover:border-primary/25 hover:bg-card transition-all duration-200 space-y-2.5"
                      data-testid={`card-feature-${title.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`}
                    >
                      <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <p className="text-sm font-semibold leading-snug">{title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-20 px-5 border-y border-border/60 bg-card/30">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12 space-y-3">
            <p className="text-xs font-semibold text-primary uppercase tracking-widest">Setup</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-how-heading">
              Coaching infrastructure, live in a day
            </h2>
          </div>

          <div className="space-y-6">
            {[
              {
                step: "01",
                title: "Register your coaching business",
                description: "Sign up and your branded platform is live instantly. Add your logo, colors, and coaching URL — clients see your business, not ours.",
              },
              {
                step: "02",
                title: "Build your schedule and connect Stripe",
                description: "Add coaches, configure locations, set your availability, and link your Stripe account. Clone sessions to fill out weeks of programming in minutes.",
              },
              {
                step: "03",
                title: "Share your link, start getting paid",
                description: "Send clients your branded URL. They sign up, book sessions, and pay through Stripe. You track every dollar, every session, and every payout from one dashboard.",
              },
            ].map(({ step, title, description }) => (
              <div key={step} className="flex gap-5 items-start" data-testid={`step-${step}`}>
                <div className="flex-shrink-0 w-11 h-11 rounded-full border border-primary/30 bg-primary/8 flex items-center justify-center">
                  <span className="text-xs font-bold text-primary">{step}</span>
                </div>
                <div className="space-y-1.5 pt-1.5 pb-2 border-b border-border/40 flex-1 last:border-0">
                  <h3 className="text-base font-semibold">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <Button size="lg" onClick={() => openRegisterModal()} className="px-8 h-11 text-sm" data-testid="button-how-cta">
              Start Free 3-Day Trial
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="py-20 px-5">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12 space-y-3">
            <p className="text-xs font-semibold text-primary uppercase tracking-widest">Pricing</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-pricing-heading">One plan. Everything included.</h2>
            <p className="text-muted-foreground max-w-sm mx-auto text-sm">
              No tiers, no per-seat fees, no feature gates. Every coaching business gets the full platform.
            </p>
          </div>

          <div className="max-w-lg mx-auto">
            <Card
              className="p-8 border-primary/25 shadow-lg relative overflow-hidden"
              data-testid="card-pricing"
            >
              <div className="absolute top-0 right-0 w-48 h-48 bg-primary/4 rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
              <div className="relative">
                <div className="text-center space-y-2 mb-8">
                  <div className="flex items-baseline justify-center gap-1.5">
                    <span className="text-4xl sm:text-5xl font-bold" data-testid="text-pricing-amount">$49.99</span>
                    <span className="text-lg text-muted-foreground">/month</span>
                  </div>
                  <p className="text-sm text-muted-foreground">Start with a free 3-day trial — no charge until it ends</p>
                </div>

                <div className="grid sm:grid-cols-2 gap-2.5 mb-8">
                  {[
                    "Unlimited coaches & clients",
                    "Your own branded landing page",
                    "Full scheduling & booking system",
                    "Stripe payment integration",
                    "Client wallet & session credits",
                    "Team training contracts",
                    "Session redemptions & payouts",
                    "Automated email notifications",
                    "Business analytics dashboard",
                    "Multi-location support",
                  ].map((feature) => (
                    <div key={feature} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>

                <Button size="lg" className="w-full h-11 text-sm" onClick={() => openRegisterModal()} data-testid="button-pricing-cta">
                  Start Free 3-Day Trial
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
                <p className="text-xs text-center text-muted-foreground mt-3">No credit card required to start your trial</p>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="py-20 px-5 border-t border-border/60">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/25 bg-primary/8 text-xs font-medium text-primary mb-2">
            <Activity className="h-3.5 w-3.5" />
            Your coaching business, fully operational
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-cta-heading">
            Ready to run your business<br className="hidden sm:block" /> like the professional you are?
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
            Stop managing clients through spreadsheets and Venmo. Start using infrastructure that was built for exactly what you do.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button size="lg" onClick={() => openRegisterModal()} className="w-full sm:w-auto px-8 h-11 text-sm" data-testid="button-final-cta">
              Start Free 3-Day Trial
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <Button variant="outline" size="lg" onClick={() => setCoachModalOpen(true)} className="w-full sm:w-auto px-8 h-11 text-sm" data-testid="button-final-login">
              <LogIn className="h-4 w-4 mr-2" />
              Already a Coach? Sign In
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Free for 3 days. Then $49.99/month. Cancel anytime.
          </p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="py-8 px-5 border-t border-border/50">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center">
                <Dumbbell className="h-3 w-3 text-primary" />
              </div>
              <span className="font-medium text-foreground/70">TrainEfficiency</span>
              <span>— Built for S&C coaches</span>
            </div>
            <div className="flex items-center gap-4">
              <a href="/privacy" className="hover:text-foreground transition-colors" data-testid="link-privacy-policy">Privacy</a>
              <a href="/terms" className="hover:text-foreground transition-colors" data-testid="link-terms-conditions">Terms</a>
              <a href="mailto:Bryan.jones@efficiencystrengthtraining.com" className="hover:text-foreground transition-colors flex items-center gap-1" data-testid="link-contact-support">
                <Mail className="h-3 w-3" />
                Contact
              </a>
            </div>
          </div>
          <div className="text-xs text-muted-foreground/60 text-center mt-5">
            &copy; {new Date().getFullYear()} Train Efficiency Business Solutions. All rights reserved.
          </div>
        </div>
      </footer>

      {/* ── COACH LOGIN MODAL ── */}
      <Dialog open={coachModalOpen} onOpenChange={(open) => {
        setCoachModalOpen(open);
        if (!open) { setEmail(""); setPassword(""); setError(""); setShowPassword(false); }
      }}>
        <DialogContent className="sm:max-w-md" data-testid="modal-coach-login">
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
              <label htmlFor="coach-email" className="text-sm font-medium">Email</label>
              <Input
                id="coach-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                required
                data-testid="input-coach-email"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="coach-password" className="text-sm font-medium">Password</label>
                <a href="/forgot-password" className="text-sm text-primary hover:underline underline-offset-4" data-testid="link-forgot-password">
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <Input
                  id="coach-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  required
                  className="pr-10"
                  data-testid="input-coach-password"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute right-0 top-0"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive" data-testid="text-login-error">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isLoading || !email || !password}
              data-testid="button-coach-login-submit"
            >
              <LogIn className="h-4 w-4 mr-2" />
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── REGISTER MODAL ── */}
      <Dialog open={registerModalOpen} onOpenChange={(open) => {
        setRegisterModalOpen(open);
        if (!open) resetForm();
      }}>
        <DialogContent className="sm:max-w-lg" data-testid="modal-register-org">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Register Your Coaching Business
            </DialogTitle>
            <DialogDescription>
              Start your free 3-day trial. You'll get your own branded landing page, client portal, and full coaching platform.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRegister} className="space-y-4 pt-2">
            <div className="space-y-2">
              <label htmlFor="reg-business" className="text-sm font-medium">Business Name</label>
              <Input
                id="reg-business"
                placeholder="e.g. Elite Performance Training"
                value={businessName}
                onChange={(e) => {
                  setBusinessName(e.target.value);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
                  setError("");
                }}
                required
                data-testid="input-reg-business-name"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="reg-slug" className="text-sm font-medium">Your Platform URL</label>
              <div className="flex items-center gap-0">
                <span className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded-l-md border border-r-0">
                  /org/
                </span>
                <Input
                  id="reg-slug"
                  placeholder="elite-performance"
                  value={slug}
                  onChange={(e) => { setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); setError(""); }}
                  required
                  className="rounded-l-none"
                  data-testid="input-reg-slug"
                />
              </div>
              <p className="text-xs text-muted-foreground">This is where your clients will sign up and book sessions.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label htmlFor="reg-first" className="text-sm font-medium">First Name</label>
                <Input
                  id="reg-first"
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => { setFirstName(e.target.value); setError(""); }}
                  required
                  data-testid="input-reg-first-name"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="reg-last" className="text-sm font-medium">Last Name</label>
                <Input
                  id="reg-last"
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => { setLastName(e.target.value); setError(""); }}
                  required
                  data-testid="input-reg-last-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="reg-email" className="text-sm font-medium">Email</label>
              <Input
                id="reg-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                required
                data-testid="input-reg-email"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="reg-password" className="text-sm font-medium">Password</label>
              <div className="relative">
                <Input
                  id="reg-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Create a password (6+ characters)"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  required
                  minLength={6}
                  className="pr-10"
                  data-testid="input-reg-password"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute right-0 top-0"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-reg-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive" data-testid="text-reg-error">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isLoading || !businessName || !slug || !email || !password || !firstName || !lastName}
              data-testid="button-reg-submit"
            >
              <ArrowRight className="h-4 w-4 mr-2" />
              {isLoading ? "Creating your platform..." : "Start Free 3-Day Trial"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Free for 3 days, then $49.99/month. No credit card required to start.
            </p>
            <p className="text-center text-xs text-muted-foreground">
              Already have an account?{" "}
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => { setRegisterModalOpen(false); setCoachModalOpen(true); }}
                data-testid="button-reg-to-login"
              >
                Coach Sign In
              </button>
            </p>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
