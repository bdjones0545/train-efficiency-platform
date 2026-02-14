import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dumbbell, Calendar, Users, Shield, Clock, TrendingUp } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Dumbbell className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-lg tracking-tight" data-testid="text-brand-name">
              Efficiency ST
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a href="#features">
              <Button variant="ghost" size="sm" data-testid="link-features">Features</Button>
            </a>
            <a href="/api/login">
              <Button data-testid="button-login">Get Started</Button>
            </a>
          </div>
        </div>
      </nav>

      <section className="pt-32 pb-20 px-6">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-primary/10 text-primary text-sm font-medium">
              <TrendingUp className="h-3.5 w-3.5" />
              Train Smarter, Not Harder
            </div>
            <h1 className="text-4xl sm:text-5xl font-serif font-bold tracking-tight leading-tight">
              Your Personal Training,{" "}
              <span className="text-primary">Simplified</span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-lg">
              Book sessions with expert coaches, manage your training schedule, and achieve your
              fitness goals with Efficiency Strength Training's streamlined scheduling platform.
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

          <div className="relative hidden lg:block">
            <div className="aspect-square max-w-md mx-auto rounded-md overflow-hidden bg-gradient-to-br from-primary/20 via-primary/10 to-background border">
              <div className="h-full flex flex-col items-center justify-center p-8 space-y-6">
                <Dumbbell className="h-20 w-20 text-primary/40" />
                <div className="text-center space-y-2">
                  <p className="text-xl font-semibold">Expert Coaching</p>
                  <p className="text-muted-foreground text-sm">Personalized programs for every level</p>
                </div>
                <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
                  {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
                    <div
                      key={day}
                      className="py-2 px-3 rounded-md bg-background/80 text-center text-xs font-medium border"
                    >
                      {day}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="py-20 px-6 bg-card/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 space-y-3">
            <h2 className="text-3xl font-serif font-bold">Everything You Need</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              A complete platform for strength training scheduling, from booking to billing.
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
                description: "Choose from certified coaches specializing in strength, mobility, and performance.",
              },
              {
                icon: Dumbbell,
                title: "Flexible Services",
                description: "From 1-on-1 sessions to group training, find the format that fits your goals.",
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
                description: "View your session history and stay on top of your training journey.",
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
            <Dumbbell className="h-4 w-4 text-primary" />
            <span>Efficiency Strength Training LLC</span>
          </div>
          <p>&copy; {new Date().getFullYear()} All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
