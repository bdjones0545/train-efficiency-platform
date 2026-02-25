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
  ClipboardList, UserCheck, Wallet, Receipt, Building2, CheckCircle2, ArrowRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { setAuthToken } from "@/lib/authToken";
import logoImg from "@assets/A5CAB7DB-0296-44BE-A684-9F213A62D633_1772032608136.png";

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
        businessName,
        slug,
        email,
        password,
        firstName,
        lastName,
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
        window.location.href = "/coach";
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
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-lg tracking-tight" data-testid="text-brand-name">
              Train Efficiency Business Solutions
            </span>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <a href="#features">
              <Button variant="ghost" size="sm" data-testid="link-features">Features</Button>
            </a>
            <a href="#how-it-works">
              <Button variant="ghost" size="sm" data-testid="link-how-it-works">How It Works</Button>
            </a>
            <a href="/efficiencystrength">
              <Button variant="ghost" size="sm" data-testid="link-client-portal">
                <Dumbbell className="h-4 w-4 mr-1" />
                Client Portal
              </Button>
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCoachModalOpen(true)}
              data-testid="button-coach-login"
            >
              <LogIn className="h-4 w-4 mr-1" />
              Coach Login
            </Button>
            <Button
              onClick={() => openRegisterModal()}
              data-testid="button-get-started"
            >
              <UserPlus className="h-4 w-4 mr-1" />
              Get Started
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="button-mobile-menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden border-t bg-background/95 backdrop-blur-md px-6 py-4 flex flex-col gap-2" data-testid="mobile-menu">
            <a href="#features" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start" data-testid="link-features-mobile">Features</Button>
            </a>
            <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start" data-testid="link-how-it-works-mobile">How It Works</Button>
            </a>
            <a href="/efficiencystrength" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start" data-testid="link-client-portal-mobile">
                <Dumbbell className="h-4 w-4 mr-1" />
                Client Portal
              </Button>
            </a>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => { setCoachModalOpen(true); setMobileMenuOpen(false); }}
              data-testid="button-coach-login-mobile"
            >
              <LogIn className="h-4 w-4 mr-1" />
              Coach Login
            </Button>
            <Button
              className="w-full justify-start"
              onClick={() => { openRegisterModal(); setMobileMenuOpen(false); }}
              data-testid="button-get-started-mobile"
            >
              <UserPlus className="h-4 w-4 mr-1" />
              Get Started
            </Button>
          </div>
        )}
      </nav>

      <section className="relative pt-32 pb-24 px-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-primary/4 pointer-events-none" />
        <div className="max-w-6xl mx-auto flex flex-col items-center text-center relative">
          <div className="space-y-6 max-w-3xl">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight" data-testid="text-hero-heading">
              Stop Using Studio Software.{" "}
              <span className="text-primary">Start Using Coaching Software.</span>
            </h1>
            <div className="flex justify-center pt-2 pb-2">
              <img
                src={logoImg}
                alt="TrainEfficiency.com"
                className="w-full max-w-md object-contain"
                data-testid="img-hero-logo"
              />
            </div>
            <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              The all-in-one platform built for strength & conditioning coaches. Manage scheduling,
              payments, clients, team contracts, and payouts — all from one dashboard.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
              <Button size="lg" onClick={() => openRegisterModal()} data-testid="button-hero-cta">
                <ArrowRight className="h-4 w-4 mr-2" />
                Start Your Free Account
              </Button>
              <Button variant="outline" size="lg" onClick={() => setCoachModalOpen(true)} data-testid="button-hero-login">
                <LogIn className="h-4 w-4 mr-2" />
                Coach Sign In
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground pt-4">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                No monthly fees
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Built for S&C coaches
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Set up in minutes
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 px-6 bg-card/50 border-y">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-4 space-y-2">
            <p className="text-sm font-medium text-primary uppercase tracking-wider">The Problem</p>
            <h2 className="text-2xl sm:text-3xl font-bold" data-testid="text-problem-heading">
              Generic fitness software wasn't built for coaches like you
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Studio and gym management tools are designed for yoga classes and group fitness.
              You need software that understands private training, semi-privates, team contracts, and session-based payouts.
            </p>
          </div>
        </div>
      </section>

      <section id="features" className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14 space-y-3">
            <p className="text-sm font-medium text-primary uppercase tracking-wider">Platform Features</p>
            <h2 className="text-3xl font-bold" data-testid="text-features-heading">Everything You Need to Run Your Coaching Business</h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              From booking your first client to managing team contracts — we've got you covered.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Calendar,
                title: "Smart Scheduling",
                description: "Set your availability by day, time, and location. Clients book directly from your open slots — no back-and-forth texting.",
              },
              {
                icon: Users,
                title: "Semi-Private Sessions",
                description: "Run group training with configurable participant limits, age ranges, and skill levels. Clients sign up for open spots.",
              },
              {
                icon: Building2,
                title: "Team Training Contracts",
                description: "Generate team quotes with per-athlete pricing, multi-month invoicing through Stripe, and automatic recurring billing.",
              },
              {
                icon: CreditCard,
                title: "Stripe Payments Built In",
                description: "Accept payments for session packages, team contracts, and wallet top-ups. Everything flows through your Stripe account.",
              },
              {
                icon: Wallet,
                title: "Client Wallet System",
                description: "Clients prepay for session credits. Balances are tracked automatically. Coaches redeem sessions against wallet funds.",
              },
              {
                icon: Receipt,
                title: "Session Redemptions & Payouts",
                description: "Mark sessions complete, track what you're owed, and request payouts. Full transparency on every dollar.",
              },
              {
                icon: ClipboardList,
                title: "Client Management",
                description: "Manage your full client roster. View booking history, session credits, and contact info — all in one place.",
              },
              {
                icon: Mail,
                title: "Automated Email Notifications",
                description: "Booking confirmations, payment receipts, team invoices, and reminder emails sent automatically via SendGrid.",
              },
              {
                icon: BarChart3,
                title: "Business Plan & Analytics",
                description: "Set revenue goals, track sessions completed, and monitor your earnings. See your coaching business at a glance.",
              },
              {
                icon: Clock,
                title: "Session Cloning & Repeats",
                description: "Clone sessions daily, weekly, or on specific days of the week. Build your recurring schedule in seconds.",
              },
              {
                icon: UserCheck,
                title: "Multi-Location Support",
                description: "Manage sessions across different training locations. Clients see exactly where each session takes place.",
              },
              {
                icon: Shield,
                title: "Role-Based Access",
                description: "Separate dashboards for coaches, clients, and admins. Everyone sees exactly what they need — nothing more.",
              },
            ].map(({ icon: Icon, title, description }) => (
              <Card key={title} className="p-6 space-y-3 hover-elevate" data-testid={`card-feature-${title.toLowerCase().replace(/\s+/g, '-')}`}>
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

      <section id="how-it-works" className="py-20 px-6 bg-card/50 border-y">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14 space-y-3">
            <p className="text-sm font-medium text-primary uppercase tracking-wider">How It Works</p>
            <h2 className="text-3xl font-bold" data-testid="text-how-heading">Get Up and Running in 3 Steps</h2>
          </div>

          <div className="space-y-8">
            {[
              {
                step: "1",
                title: "Create Your Coach Account",
                description: "Sign up, set your hourly rate, add your bio and specialties, and configure your training locations. Your profile is live in minutes.",
              },
              {
                step: "2",
                title: "Set Your Availability & Start Booking",
                description: "Define your weekly availability by day, time, and location. Clients can browse your open slots, book sessions, and pay through Stripe — or you can schedule sessions directly.",
              },
              {
                step: "3",
                title: "Train, Redeem, Get Paid",
                description: "After each session, mark it complete and redeem it. Track your earnings on your dashboard, request payouts, and watch your business grow.",
              },
            ].map(({ step, title, description }) => (
              <div key={step} className="flex gap-5 items-start" data-testid={`step-${step}`}>
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-bold">
                  {step}
                </div>
                <div className="space-y-1 pt-1">
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <Button size="lg" onClick={() => openRegisterModal()} data-testid="button-how-cta">
              <ArrowRight className="h-4 w-4 mr-2" />
              Create Your Coach Account
            </Button>
          </div>
        </div>
      </section>

      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14 space-y-3">
            <p className="text-sm font-medium text-primary uppercase tracking-wider">Built Different</p>
            <h2 className="text-3xl font-bold" data-testid="text-why-heading">Why Coaches Choose Train Efficiency</h2>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            {[
              {
                icon: Dumbbell,
                title: "Purpose-Built for S&C",
                description: "Not a yoga studio app repurposed for trainers. Every feature is designed around how strength & conditioning coaches actually work.",
              },
              {
                icon: DollarSign,
                title: "No Monthly Subscription",
                description: "No seat fees, no monthly charges, no hidden costs. The platform earns when you earn — aligned incentives.",
              },
              {
                icon: TrendingUp,
                title: "Scale from Solo to Team",
                description: "Start with private sessions. Add semi-privates. Land a team contract. The platform grows with your business.",
              },
              {
                icon: Zap,
                title: "Fast & Simple",
                description: "No 30-page setup wizard. Set your availability, share your link, and start booking clients today.",
              },
            ].map(({ icon: Icon, title, description }) => (
              <Card key={title} className="p-6 space-y-3" data-testid={`card-why-${title.toLowerCase().replace(/\s+/g, '-')}`}>
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

      <section className="py-20 px-6 bg-primary/5 border-y">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h2 className="text-3xl font-bold" data-testid="text-cta-heading">Ready to Run Your Business Like a Pro?</h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Join coaches who are ditching spreadsheets, Venmo requests, and studio software that doesn't fit.
            Start managing your coaching business the right way.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Button size="lg" onClick={() => openRegisterModal()} data-testid="button-final-cta">
              <ArrowRight className="h-4 w-4 mr-2" />
              Get Started Free
            </Button>
            <Button variant="outline" size="lg" onClick={() => setCoachModalOpen(true)} data-testid="button-final-login">
              <LogIn className="h-4 w-4 mr-2" />
              Already a Coach? Sign In
            </Button>
          </div>
        </div>
      </section>

      <footer className="py-8 px-6 border-t">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <img src={logoImg} alt="TrainEfficiency" className="h-8 rounded-sm" data-testid="img-footer-logo" />
            <span>Train Efficiency Business Solutions</span>
          </div>
          <p>&copy; {new Date().getFullYear()} All rights reserved.</p>
        </div>
      </footer>

      <Dialog open={coachModalOpen} onOpenChange={(open) => {
        setCoachModalOpen(open);
        if (!open) {
          setEmail("");
          setPassword("");
          setError("");
          setShowPassword(false);
        }
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
              <label htmlFor="coach-password" className="text-sm font-medium">Password</label>
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
            {error && (
              <p className="text-sm text-destructive" data-testid="text-login-error">{error}</p>
            )}
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
              Create your platform in minutes. You'll get your own landing page, client portal, and coach dashboard.
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
            {error && (
              <p className="text-sm text-destructive" data-testid="text-reg-error">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isLoading || !businessName || !slug || !email || !password || !firstName || !lastName}
              data-testid="button-reg-submit"
            >
              <ArrowRight className="h-4 w-4 mr-2" />
              {isLoading ? "Creating your platform..." : "Create My Platform"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Already have an account? Use <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => { setRegisterModalOpen(false); setCoachModalOpen(true); }} data-testid="button-reg-to-login">Coach Sign In</button> instead.
            </p>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
