import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Calendar, Users, Shield, Clock, TrendingUp, Zap, UserCog, CalendarClock, DollarSign, LogIn } from "lucide-react";
import logoImg from "@assets/IMG_7961_1771105509253.jpeg";

export default function LandingPage() {
  const [coachModalOpen, setCoachModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <img src={logoImg} alt="EST Logo" className="h-8 rounded-md" data-testid="img-nav-logo" />
            <span className="font-semibold text-lg tracking-tight" data-testid="text-brand-name">
              Efficiency Strength Training
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a href="#features">
              <Button variant="ghost" size="sm" data-testid="link-features">Features</Button>
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCoachModalOpen(true)}
              data-testid="button-coach-login"
            >
              Coach Login
            </Button>
            <a href="/api/login">
              <Button data-testid="button-login">Get Started</Button>
            </a>
          </div>
        </div>
      </nav>

      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-primary/4 pointer-events-none" />
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center relative">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-primary/10 text-primary text-sm font-medium">
              <Zap className="h-3.5 w-3.5" />
              Elevate Your Game
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
              Sports Performance,{" "}
              <span className="text-primary">Simplified</span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-lg">
              Book sessions with expert strength & conditioning coaches, manage your training schedule,
              and take your athletic performance to the next level with Efficiency Strength Training.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a href="/api/login">
                <Button size="lg" data-testid="button-hero-cta">
                  <Calendar className="h-4 w-4 mr-2" />
                  Book a Session
                </Button>
              </a>
              <a href="#features">
                <Button variant="outline" size="lg" data-testid="button-learn-more">
                  Learn More
                </Button>
              </a>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground pt-2">
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

          <div className="relative hidden lg:flex items-center justify-center">
            <div className="relative">
              <div className="absolute -inset-4 bg-primary/10 rounded-md blur-2xl" />
              <img
                src={logoImg}
                alt="Efficiency Strength Training"
                className="relative w-80 h-80 object-contain rounded-md"
                data-testid="img-hero-logo"
              />
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

      <footer className="py-8 px-6 border-t">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <img src={logoImg} alt="EST" className="h-5 rounded-sm" data-testid="img-footer-logo" />
            <span>Efficiency Strength Training LLC</span>
          </div>
          <p>&copy; {new Date().getFullYear()} All rights reserved.</p>
        </div>
      </footer>

      <Dialog open={coachModalOpen} onOpenChange={setCoachModalOpen}>
        <DialogContent className="sm:max-w-md" data-testid="modal-coach-login">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5 text-primary" />
              Coach Portal
            </DialogTitle>
            <DialogDescription>
              Sign in to access your coaching dashboard and manage your sessions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-3">
              {[
                { icon: UserCog, label: "Edit your profile and specialties" },
                { icon: CalendarClock, label: "Manage your weekly availability" },
                { icon: Calendar, label: "View and manage client bookings" },
                { icon: DollarSign, label: "Redeem completed sessions" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-3 text-sm">
                  <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <span data-testid={`text-coach-feature-${label.slice(0, 10).replace(/\s/g, '-').toLowerCase()}`}>{label}</span>
                </div>
              ))}
            </div>
            <a href="/api/login?returnTo=/coach" className="block">
              <Button className="w-full" size="lg" data-testid="button-coach-login-submit">
                <LogIn className="h-4 w-4 mr-2" />
                Sign In as Coach
              </Button>
            </a>
            <p className="text-xs text-center text-muted-foreground">
              Contact an administrator if you need coach access.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
