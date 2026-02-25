import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Calendar, Users, Shield, Clock, TrendingUp, Zap, UserCog, LogIn, Eye, EyeOff, UserPlus, Trophy, Menu, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { setAuthToken } from "@/lib/authToken";
import logoImg from "@assets/A5CAB7DB-0296-44BE-A684-9F213A62D633_1772032608136.png";
import type { CoachWithUser } from "@/lib/types";

export default function LandingPage() {
  const { data: coaches } = useQuery<CoachWithUser[]>({ queryKey: ["/api/coaches"] });
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
    } catch (err: any) {
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
        ? { email, password, firstName, lastName }
        : { email, password };

      const res = await apiRequest("POST", endpoint, body);
      const data = await res.json();
      if (data.success) {
        if (data.token) setAuthToken(data.token);
        toast({ title: isSignUp ? "Account created!" : "Welcome back!", description: "Redirecting..." });
        setClientModalOpen(false);
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      }
    } catch (err: any) {
      try {
        const msg = await err?.message;
        if (msg) {
          setError(msg);
        } else {
          setError(isSignUp ? "Registration failed. Try a different email." : "Invalid email or password.");
        }
      } catch {
        setError(isSignUp ? "Registration failed. Try a different email." : "Invalid email or password.");
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
            <a href="/athletic">
              <Button variant="ghost" size="sm" data-testid="link-blhs-athletic">
                <Trophy className="h-4 w-4 mr-1" />
                BLHS Athletic
              </Button>
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCoachModalOpen(true)}
              data-testid="button-coach-login"
            >
              Coach Login
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openClientModal(false)}
              data-testid="button-login"
            >
              <LogIn className="h-4 w-4 mr-1" />
              Log In
            </Button>
            <Button
              onClick={() => openClientModal(true)}
              data-testid="button-get-started"
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
            <a href="/athletic" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start" data-testid="link-blhs-athletic-mobile">
                <Trophy className="h-4 w-4 mr-1" />
                BLHS Athletic
              </Button>
            </a>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => { setCoachModalOpen(true); setMobileMenuOpen(false); }}
              data-testid="button-coach-login-mobile"
            >
              Coach Login
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => { openClientModal(false); setMobileMenuOpen(false); }}
              data-testid="button-login-mobile"
            >
              <LogIn className="h-4 w-4 mr-1" />
              Log In
            </Button>
            <Button
              className="w-full justify-start"
              onClick={() => { openClientModal(true); setMobileMenuOpen(false); }}
              data-testid="button-get-started-mobile"
            >
              <UserPlus className="h-4 w-4 mr-1" />
              Sign Up
            </Button>
          </div>
        )}
      </nav>

      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-primary/4 pointer-events-none" />
        <div className="max-w-6xl mx-auto flex flex-col items-center text-center relative">
          <div className="space-y-6 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-primary/10 text-primary text-sm font-medium">
              <Zap className="h-3.5 w-3.5" />
              Elevate Your Game
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
              Train Efficiency{" "}
              <span className="text-primary">Business Solutions</span>
            </h1>
            <div className="flex justify-center pt-2">
              <img
                src={logoImg}
                alt="TrainEfficiency.com"
                className="w-full max-w-md object-contain"
                data-testid="img-hero-logo"
              />
            </div>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Book sessions with expert strength & conditioning coaches, manage your training schedule,
              and take your athletic performance to the next level.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" onClick={() => openClientModal(true)} data-testid="button-hero-cta">
                <Calendar className="h-4 w-4 mr-2" />
                Book a Session
              </Button>
              <a href="/sessions">
                <Button variant="outline" size="lg" data-testid="button-view-sessions">
                  <Users className="h-4 w-4 mr-2" />
                  View Group Sessions
                </Button>
              </a>
            </div>
            <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground pt-2">
              <span className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                Free to browse
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-primary" />
                Instant booking
              </span>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="py-20 px-6 bg-card/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 space-y-3">
            <h2 className="text-3xl font-bold">Everything You Need</h2>
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
              <h2 className="text-3xl font-bold" data-testid="text-coaches-heading">Meet Our Coaches</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Train with experienced strength & conditioning professionals dedicated to your athletic development.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-8 max-w-3xl mx-auto">
              {coaches.map((coach) => (
                <Card key={coach.id} className="p-6 space-y-4" data-testid={`card-landing-coach-${coach.id}`}>
                  <div className="flex items-center gap-4">
                    <Avatar className="h-16 w-16">
                      <AvatarImage src={coach.photoUrl || coach.user?.profileImageUrl || undefined} data-testid={`img-coach-photo-${coach.id}`} />
                      <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                        {(coach.user?.firstName?.[0] || "C").toUpperCase()}
                        {(coach.user?.lastName?.[0] || "").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="text-lg font-semibold" data-testid={`text-landing-coach-name-${coach.id}`}>
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
                      {coach.specialties.map((spec) => (
                        <Badge key={spec} variant="secondary" className="text-xs">{spec}</Badge>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
            <div className="text-center mt-8">
              <Button size="lg" onClick={() => openClientModal(true)} data-testid="button-coaches-cta">
                <Calendar className="h-4 w-4 mr-2" />
                Sign Up to Book a Session
              </Button>
            </div>
          </div>
        </section>
      )}

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
                placeholder="you@efficiencystrengthtraining.com"
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

      <Dialog open={clientModalOpen} onOpenChange={(open) => {
        setClientModalOpen(open);
        if (!open) resetClientForm();
      }}>
        <DialogContent className="sm:max-w-md" data-testid="modal-client-auth">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isSignUp ? <UserPlus className="h-5 w-5 text-primary" /> : <LogIn className="h-5 w-5 text-primary" />}
              {isSignUp ? "Create Account" : "Welcome Back"}
            </DialogTitle>
            <DialogDescription>
              {isSignUp
                ? "Sign up to book sessions and manage your training schedule."
                : "Log in to your account to view and manage your bookings."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleClientAuth} className="space-y-4 pt-2">
            {isSignUp && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label htmlFor="client-first" className="text-sm font-medium">First Name</label>
                  <Input
                    id="client-first"
                    placeholder="First name"
                    value={firstName}
                    onChange={(e) => { setFirstName(e.target.value); setError(""); }}
                    required
                    data-testid="input-client-first-name"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="client-last" className="text-sm font-medium">Last Name</label>
                  <Input
                    id="client-last"
                    placeholder="Last name"
                    value={lastName}
                    onChange={(e) => { setLastName(e.target.value); setError(""); }}
                    required
                    data-testid="input-client-last-name"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor="client-email" className="text-sm font-medium">Email</label>
              <Input
                id="client-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                required
                data-testid="input-client-email"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="client-password" className="text-sm font-medium">Password</label>
              <div className="relative">
                <Input
                  id="client-password"
                  type={showPassword ? "text" : "password"}
                  placeholder={isSignUp ? "Create a password (6+ characters)" : "Enter your password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  required
                  minLength={6}
                  className="pr-10"
                  data-testid="input-client-password"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute right-0 top-0"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-client-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive" data-testid="text-client-auth-error">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isLoading || !email || !password || (isSignUp && (!firstName || !lastName))}
              data-testid="button-client-auth-submit"
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
                    data-testid="button-switch-to-login"
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
                    data-testid="button-switch-to-signup"
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
