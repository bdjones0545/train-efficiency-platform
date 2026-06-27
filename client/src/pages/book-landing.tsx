import { TrainLogo } from "@/components/train-logo";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import bookHeroImg from "@assets/B44D7E27-9E35-4B28-9E5F-4B0A73EAA972_1782438528568.PNG";
import { apiRequest } from "@/lib/queryClient";
import { trackViewContent, trackLead, generateEventId, getMetaCookies } from "@/lib/meta-pixel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import {
  Zap,
  Layout,
  Users,
  FlaskConical,
  TrendingUp,
  BookOpen,
  MessageSquare,
  Star,
  Award,
  CheckCircle2,
  ChevronRight,
  ArrowRight,
  ShoppingCart,
  Eye,
  Loader2,
} from "lucide-react";

const AMAZON_BOOK_URL = "https://www.amazon.com/dp/B0H6CDZ85W";

// TODO: If app-level analytics are added, wire these events into that system
function trackEvent(name: string, props?: Record<string, unknown>) {
  console.log(`[Analytics] ${name}`, props ?? {});
}

interface EmailLeadForm {
  firstName: string;
  lastName: string;
  email: string;
  sendInstructions: boolean;
}

interface EmailLeadErrors {
  firstName?: string;
  email?: string;
  sendInstructions?: string;
}

export default function BookLandingPage() {
  const [, navigate] = useLocation();
  const [ctaModalOpen, setCtaModalOpen] = useState(false);
  const [form, setForm] = useState<EmailLeadForm>({
    firstName: "",
    lastName: "",
    email: "",
    sendInstructions: false,
  });
  const [errors, setErrors] = useState<EmailLeadErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const previewRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  function handlePurchaseCta() {
    trackEvent("book_purchase_cta_clicked");
    // Reset form state each time modal opens
    setForm({ firstName: "", lastName: "", email: "", sendInstructions: false });
    setErrors({});
    setCtaModalOpen(true);
  }

  function handlePreviewCta() {
    trackEvent("book_preview_clicked");
    previewRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  function validateForm(): EmailLeadErrors {
    const errs: EmailLeadErrors = {};
    if (!form.firstName.trim()) errs.firstName = "First name is required.";
    if (!form.email.trim()) {
      errs.email = "Email address is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errs.email = "Please enter a valid email address.";
    }
    if (!form.sendInstructions) {
      errs.sendInstructions = "Please check the box to receive your redemption instructions.";
    }
    return errs;
  }

  async function handleModalSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateForm();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setIsSubmitting(true);

    try {
      const isPlaceholderUrl = AMAZON_BOOK_URL.includes("TODO");

      // 1. Generate a unique event ID for this Lead action.
      //    The same ID is sent to both fbq (browser pixel) and the server-side
      //    CAPI call so Meta deduplicates them — only one Lead is counted.
      const leadEventId = generateEventId();
      const metaCookies = getMetaCookies();

      // 2. Persist lead (create or update by email) — includes eventId and
      //    fbp/fbc cookies so the server-side CAPI call is fully enriched.
      const leadRes = await apiRequest("POST", "/api/book-funnel/leads", {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim() || undefined,
        email: form.email.trim(),
        source: "book_landing",
        amazonClicked: !isPlaceholderUrl,
        eventId: leadEventId,
        fbp: metaCookies.fbp,
        fbc: metaCookies.fbc,
      });
      const leadData = await leadRes.json();
      const leadId: string | undefined = leadData?.leadId;

      // 3. Log book_email_submitted event
      trackEvent("book_email_submitted", { email: form.email });
      await apiRequest("POST", "/api/book-funnel/events", {
        leadId,
        email: form.email.trim(),
        eventType: "book_email_submitted",
        metadata: { source: "book_landing" },
      });

      // 4. Fire Meta Pixel Lead event (browser-side).
      //    event_id matches the server CAPI event so Meta deduplicates them.
      trackLead({ content_name: "Train Efficiency Book" }, leadEventId);

      // 4. Navigate to thank-you page (handles Amazon redirect from there)
      setCtaModalOpen(false);
      navigate(`/book/thank-you?email=${encodeURIComponent(form.email.trim())}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      toast({
        title: "Unable to save your details",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasTrackedViewContent = useRef(false);
  useEffect(() => {
    if (hasTrackedViewContent.current) return;
    hasTrackedViewContent.current = true;
    trackEvent("book_page_view");
    trackViewContent({ content_name: "Train Efficiency Book", content_category: "book" });
  }, []);

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] selection:bg-[#ffd274]/30 selection:text-[#ffd274]">
      {/* ── Navigation ── */}
      <header className="fixed top-0 w-full z-50 bg-[#131313]/80 backdrop-blur-xl border-b border-white/10">
        <nav className="flex justify-between items-center px-6 md:px-8 py-4 max-w-[1200px] mx-auto">
          <a
            href="/"
            className="flex items-center gap-2 transition-transform active:scale-95"
            data-testid="link-book-nav-home"
          >
            <TrainLogo className="h-5 w-5 text-[#ffd274]" />
            <span className="font-bold text-lg text-[#ffd274] tracking-tight">
              TrainEfficiency
            </span>
          </a>

          <div className="hidden md:flex gap-8 items-center">
            <a
              href="#overview"
              className="text-xs font-bold tracking-widest uppercase text-[#d3c5ae] hover:text-[#ffd274] transition-colors"
            >
              Overview
            </a>
            <a
              href="#trainchat"
              className="text-xs font-bold tracking-widest uppercase text-[#d3c5ae] hover:text-[#ffd274] transition-colors"
            >
              TrainChat
            </a>
            <a
              href="#author"
              className="text-xs font-bold tracking-widest uppercase text-[#d3c5ae] hover:text-[#ffd274] transition-colors"
            >
              The Author
            </a>
          </div>

          <Button
            onClick={handlePurchaseCta}
            className="rounded-full bg-[#ffd274] text-[#402d00] hover:bg-[#ebb42d] font-bold text-xs tracking-widest uppercase px-6 py-2 transition-all hover:scale-105 active:scale-95 shadow-[inset_0_0_12px_rgba(255,255,255,0.3)]"
            data-testid="button-book-nav-purchase"
          >
            Purchase Book
          </Button>
        </nav>
      </header>

      <main className="pt-24">
        {/* ── Hero Section ── */}
        <section
          id="overview"
          className="relative min-h-[85vh] flex items-center px-6 md:px-8 py-32 overflow-hidden"
        >
          {/* Background glow */}
          <div className="absolute inset-0 z-0 pointer-events-none">
            <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] bg-[#ffd274]/5 blur-[120px] rounded-full" />
            <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] bg-[#ffd274]/3 blur-[80px] rounded-full" />
          </div>

          <div className="max-w-[1200px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 items-center z-10 w-full">
            {/* Text side */}
            <div className="order-2 md:order-1 space-y-8">
              <div className="inline-flex items-center gap-2 bg-[#ffd274]/10 border border-[#ffd274]/20 px-4 py-1.5 rounded-full">
                <span className="text-xs font-bold tracking-widest uppercase text-[#ffd274]">
                  Evidence-Based Performance
                </span>
              </div>

              <h1 className="text-[44px] md:text-[64px] font-extrabold leading-[1.1] tracking-[-0.03em] text-[#e5e2e1]">
                The Structure of Training for{" "}
                <span className="text-[#ffd274]">Strength and Speed</span> for
                Youth Athletes
              </h1>

              <p className="text-lg text-[#d3c5ae] max-w-xl leading-relaxed">
                A science-based framework designed for coaches and parents to
                develop stronger, faster, and more resilient athletes using
                long-term adaptation principles.
              </p>

              <p className="text-sm font-bold tracking-widest uppercase text-[#9c8f7a]">
                Bryan Jones, MS, CSCS, PES, EP-C
              </p>

              {/* TrainChat bonus badge */}
              <div className="inline-flex items-center gap-3 bg-[#201f1f] border border-[#ffd274]/25 rounded-xl px-5 py-3">
                <MessageSquare className="h-5 w-5 text-[#ffd274] shrink-0" />
                <div>
                  <p className="text-xs font-bold tracking-widest uppercase text-[#ffd274]">
                    Bonus Included
                  </p>
                  <p className="text-sm text-[#d3c5ae]">
                    First month of TrainChat — free with purchase
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 pt-2">
                <Button
                  onClick={handlePurchaseCta}
                  className="rounded-full bg-[#ffd274] text-[#402d00] hover:bg-[#ebb42d] font-bold text-sm tracking-widest uppercase px-10 py-6 transition-all active:scale-95 shadow-[inset_0_0_12px_rgba(255,255,255,0.3)] hover:shadow-[0_0_40px_rgba(246,190,55,0.3)]"
                  data-testid="button-hero-purchase"
                >
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Purchase Book
                </Button>
                <Button
                  variant="outline"
                  onClick={handlePreviewCta}
                  className="rounded-full bg-[#2a2a2a] text-[#e5e2e1] hover:bg-[#353534] border border-white/10 font-bold text-sm tracking-widest uppercase px-10 py-6 transition-all active:scale-95"
                  data-testid="button-hero-preview"
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Preview Book
                </Button>
              </div>
            </div>

            {/* Book hero image */}
            <div className="order-1 md:order-2 flex justify-center relative">
              <div className="absolute -inset-10 bg-[#ffd274]/5 blur-[100px] rounded-full pointer-events-none" />
              <img
                src={bookHeroImg}
                alt="The Structure of Training for Strength and Speed for Youth Athletes by Bryan Jones"
                className="relative z-10 w-full max-w-[480px] rounded-xl"
                data-testid="img-book-hero"
              />
            </div>
          </div>
        </section>

        {/* ── Value / Learning Section ── */}
        <section
          className="px-6 md:px-8 py-32 bg-[#0e0e0e]/50"
          id="overview-cards"
        >
          <div className="max-w-[1200px] mx-auto">
            <div className="text-center mb-16 space-y-4">
              <h2 className="text-[36px] md:text-[48px] font-bold leading-[1.2] tracking-[-0.02em] text-[#e5e2e1]">
                Inside The Framework
              </h2>
              <p className="text-base text-[#d3c5ae] max-w-2xl mx-auto leading-relaxed">
                Bridging the gap between raw athletic power and high-fidelity
                scientific precision.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <ValueCard
                icon={<TrendingUp className="h-8 w-8 text-[#ffd274]" />}
                title="Adaptation as the Objective"
                description="Why adaptation — not fatigue — is the true purpose of training, and how to design every session around that principle."
              />
              <ValueCard
                icon={<TrainLogo className="h-8 w-8 text-[#ffd274]" />}
                title="Building Physical Qualities"
                description="How strength, speed, power, and work capacity develop throughout the athletic journey — and in what order they should be prioritized."
              />
              <ValueCard
                icon={<Layout className="h-8 w-8 text-[#ffd274]" />}
                title="Movement Competency First"
                description="The importance of establishing sound movement patterns before introducing advanced training methods or loading."
              />
              <ValueCard
                icon={<CheckCircle2 className="h-8 w-8 text-[#ffd274]" />}
                title="The Power of Consistency"
                description="Why consistency is one of the most important — and most undervalued — factors in long-term athletic development."
              />
              <ValueCard
                icon={<Users className="h-8 w-8 text-[#ffd274]" />}
                title="Age-Appropriate Progressions"
                description="How to create training progressions that match an athlete's developmental stage rather than their sport level or physical size."
              />
              <ValueCard
                icon={<Eye className="h-8 w-8 text-[#ffd274]" />}
                title="Avoiding Common Mistakes"
                description="The most common coaching and programming errors that limit athletic development — and how to avoid them."
              />
              <ValueCard
                icon={<Zap className="h-8 w-8 text-[#ffd274]" />}
                title="Sport Practice & Physical Prep"
                description="Understanding the relationship between sport-specific practice and physical preparation — and how to balance both."
              />
              <ValueCard
                icon={<FlaskConical className="h-8 w-8 text-[#ffd274]" />}
                title="Recovery & Adaptation"
                description="How recovery influences performance and adaptation, and why it deserves the same attention as the training itself."
              />
              <ValueCard
                icon={<Award className="h-8 w-8 text-[#ffd274]" />}
                title="Building Resilient Athletes"
                description="How to develop athletes who are capable of sustained improvement — durable, adaptable, and prepared for the long arc of athletic development."
              />
            </div>
          </div>
        </section>

        {/* ── TrainChat Bonus Section ── */}
        <section className="px-6 md:px-8 py-32" id="trainchat">
          <div className="max-w-[900px] mx-auto text-center space-y-12">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 bg-[#ffd274]/10 border border-[#ffd274]/20 px-4 py-1.5 rounded-full">
                <Star className="h-3.5 w-3.5 text-[#ffd274]" />
                <span className="text-xs font-bold tracking-widest uppercase text-[#ffd274]">
                  Exclusive Bonus
                </span>
              </div>
              <h2 className="text-[36px] md:text-[48px] font-bold leading-[1.2] tracking-[-0.02em] text-[#e5e2e1]">
                30 Days of TrainChat — Free
              </h2>
              <p className="text-lg text-[#d3c5ae] max-w-2xl mx-auto leading-relaxed">
                Purchase the book and receive your first month of TrainChat
                absolutely free. The AI coaching assistant that brings your
                training programs to life.
              </p>
            </div>

            {/* Book + TrainChat value layout */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
              <div className="glass-card rounded-xl p-8 text-center space-y-3">
                <BookOpen className="h-10 w-10 text-[#ffd274] mx-auto" />
                <p className="font-bold text-[#e5e2e1] text-lg">The Book</p>
                <p className="text-sm text-[#d3c5ae]">
                  Complete evidence-based framework for youth athletic
                  development
                </p>
              </div>

              <div className="flex items-center justify-center">
                <div className="text-[#ffd274] text-3xl font-bold">+</div>
              </div>

              <div className="glass-card rounded-xl p-8 text-center space-y-3">
                <MessageSquare className="h-10 w-10 text-[#ffd274] mx-auto" />
                <p className="font-bold text-[#e5e2e1] text-lg">TrainChat</p>
                <p className="text-sm text-[#d3c5ae]">
                  First month free — AI-powered coaching assistant at your
                  fingertips
                </p>
              </div>
            </div>

            {/* Redemption instructions */}
            <div className="bg-[#201f1f] border border-[#ffd274]/20 rounded-xl p-8 text-left space-y-4">
              <p className="text-xs font-bold tracking-widest uppercase text-[#ffd274]">
                How to Redeem
              </p>
              <div className="space-y-3">
                {[
                  {
                    icon: <ShoppingCart className="h-4 w-4 text-[#ffd274]" />,
                    text: "Purchase the book on Amazon",
                  },
                  {
                    icon: <ArrowRight className="h-4 w-4 text-[#ffd274]" />,
                    text: "Upload your Amazon receipt to verify your purchase",
                  },
                  {
                    icon: (
                      <MessageSquare className="h-4 w-4 text-[#ffd274]" />
                    ),
                    text: "Enter code TRAINCHAT at TrainChat checkout — your first month is free",
                  },
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">{step.icon}</div>
                    <p className="text-sm text-[#d3c5ae]">{step.text}</p>
                  </div>
                ))}
              </div>
              {/* Activation code display */}
              <div className="mt-2 flex items-center gap-4 bg-black/40 border border-[#ffd274]/20 rounded-lg px-5 py-4">
                <div className="flex-1">
                  <p className="text-[10px] font-bold tracking-widest uppercase text-[#ffd274] mb-1">
                    Your Activation Code
                  </p>
                  <p className="text-xl font-black tracking-[0.18em] text-[#e5e2e1]" style={{ fontFamily: "monospace" }}>
                    TRAINCHAT
                  </p>
                </div>
                <a
                  href="https://www.trainchat.ai?code=TRAINCHAT"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 bg-[#ffd274] text-[#402d00] text-[10px] font-extrabold tracking-widest uppercase px-4 py-2 rounded-full hover:brightness-110 transition-all"
                  data-testid="link-trainchat-landing-cta"
                >
                  Activate →
                </a>
              </div>

              <a
                href="/book/redeem"
                className="inline-flex items-center gap-1 text-xs font-bold tracking-widest uppercase text-[#ffd274] hover:underline pt-2"
              >
                Already purchased? Upload your receipt here →
              </a>
            </div>
          </div>
        </section>

        {/* ── Author Section ── */}
        <section
          className="px-6 md:px-8 py-32 bg-[#0e0e0e]/50"
          id="author"
        >
          <div className="max-w-[1200px] mx-auto">
            <div className="text-center mb-16 space-y-4">
              <h2 className="text-[36px] md:text-[48px] font-bold leading-[1.2] tracking-[-0.02em] text-[#e5e2e1]">
                Meet the Author
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
              {/* Author photo */}
              <div className="relative flex justify-center">
                <div className="w-[280px] md:w-[360px] rounded-2xl overflow-hidden border border-white/10 shadow-[0_32px_64px_rgba(0,0,0,0.5)]">
                  <img
                    src="/bryan-jones.jpeg"
                    alt="Bryan Jones — MS, CSCS, PES, EP-C"
                    className="w-full h-auto object-cover"
                    data-testid="img-author-photo"
                  />
                </div>
                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap bg-[#201f1f] border border-[#ffd274]/20 text-[#ffd274] text-xs font-bold tracking-widest uppercase px-5 py-2 rounded-full">
                  Bryan Jones
                </div>
              </div>

              {/* Author bio */}
              <div className="space-y-6">
                <div>
                  <h2 className="text-[32px] md:text-[40px] font-bold leading-[1.2] tracking-[-0.02em] text-[#e5e2e1]">
                    Bryan Jones
                  </h2>
                  <p className="text-[#ffd274] font-bold tracking-widest text-sm uppercase mt-1">
                    MS, CSCS, PES, EP-C
                  </p>
                </div>

                <p className="text-base text-[#d3c5ae] leading-relaxed">
                  Bryan Jones is an elite strength and conditioning coach with
                  over a decade of experience developing youth athletes at the
                  high school, collegiate, and professional development levels.
                  His evidence-based methodology blends modern sports science
                  with practical, on-the-field coaching wisdom.
                </p>
                <p className="text-base text-[#d3c5ae] leading-relaxed">
                  After working with hundreds of athletes across multiple
                  sports, Bryan distilled his most effective training
                  frameworks into this comprehensive guide — designed to give
                  coaches and parents a repeatable, science-backed system for
                  long-term athletic development.
                </p>

                {/* Credentials */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  {[
                    "Master of Science — Exercise Science",
                    "Certified Strength & Conditioning Specialist (CSCS)",
                    "Performance Enhancement Specialist (PES)",
                    "Exercise Physiologist — Certified (EP-C)",
                  ].map((credential) => (
                    <div
                      key={credential}
                      className="flex items-start gap-2"
                      data-testid={`text-credential-${credential.slice(0, 10).replace(/\s/g, "-").toLowerCase()}`}
                    >
                      <CheckCircle2 className="h-4 w-4 text-[#ffd274] mt-0.5 shrink-0" />
                      <span className="text-sm text-[#d3c5ae]">
                        {credential}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Trust badge row */}
                <div className="flex flex-wrap gap-3 pt-2">
                  {["10+ Years Coaching", "Hundreds of Athletes", "Multi-Sport"].map(
                    (badge) => (
                      <span
                        key={badge}
                        className="bg-[#201f1f] border border-white/10 text-[#d3c5ae] text-xs font-bold tracking-widest uppercase px-3 py-1.5 rounded-full"
                        data-testid={`badge-author-${badge.replace(/\s/g, "-").toLowerCase()}`}
                      >
                        {badge}
                      </span>
                    )
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Book Preview Section ── */}
        <section className="px-6 md:px-8 py-32" ref={previewRef} id="preview">
          <div className="max-w-[1200px] mx-auto">
            <div className="text-center mb-16 space-y-4">
              <h2 className="text-[36px] md:text-[48px] font-bold leading-[1.2] tracking-[-0.02em] text-[#e5e2e1]">
                Preview the Book
              </h2>
              <p className="text-base text-[#d3c5ae] max-w-2xl mx-auto leading-relaxed">
                A glimpse inside the framework. Evidence-based content
                structured for coaches and parents at every level.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {previewChapters.map((chapter, i) => (
                <div
                  key={i}
                  className="glass-card rounded-xl p-8 space-y-4 hover:shadow-[0_0_40px_rgba(246,190,55,0.12)] transition-all duration-500"
                  data-testid={`card-preview-chapter-${i + 1}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold tracking-widest uppercase text-[#9c8f7a]">
                      Chapter {i + 1}
                    </span>
                    <BookOpen className="h-4 w-4 text-[#ffd274]" />
                  </div>
                  <h3 className="text-lg font-semibold text-[#e5e2e1] leading-snug">
                    {chapter.title}
                  </h3>
                  <p className="text-sm text-[#d3c5ae] leading-relaxed">
                    {chapter.excerpt}
                  </p>
                  {/* Simulated lines */}
                  <div className="space-y-2 pt-2">
                    {[85, 72, 90, 60].map((w, j) => (
                      <div
                        key={j}
                        className="h-2 bg-[#2a2a2a] rounded-full"
                        style={{ width: `${w}%` }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="text-center mt-12">
              <Button
                onClick={handlePurchaseCta}
                variant="outline"
                className="rounded-full border border-[#ffd274]/40 text-[#ffd274] hover:bg-[#ffd274]/10 font-bold text-xs tracking-widest uppercase px-8 py-3 transition-all"
                data-testid="button-preview-purchase"
              >
                Read the Full Book
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>

        {/* ── Social Proof / Trusted By Section ── */}
        <section className="px-6 md:px-8 py-20 bg-[#0e0e0e]/50">
          <div className="max-w-[1200px] mx-auto">
            <p className="text-center text-xs font-bold tracking-widest uppercase text-[#9c8f7a] mb-10">
              Trusted by Elite Coaches &amp; Parents
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {testimonials.map((t, i) => (
                <div
                  key={i}
                  className="glass-card rounded-xl p-6 space-y-4"
                  data-testid={`card-testimonial-${i}`}
                >
                  <div className="flex gap-1">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <Star
                        key={j}
                        className="h-4 w-4 fill-[#ffd274] text-[#ffd274]"
                      />
                    ))}
                  </div>
                  <p className="text-sm text-[#d3c5ae] leading-relaxed italic">
                    "{t.quote}"
                  </p>
                  <div>
                    <p className="text-sm font-bold text-[#e5e2e1]">
                      {t.name}
                    </p>
                    <p className="text-xs text-[#9c8f7a]">{t.role}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ Section ── */}
        <section className="px-6 md:px-8 py-32" id="faq">
          <div className="max-w-[800px] mx-auto">
            <div className="text-center mb-16 space-y-4">
              <h2 className="text-[36px] md:text-[48px] font-bold leading-[1.2] tracking-[-0.02em] text-[#e5e2e1]">
                Common Questions
              </h2>
              <p className="text-base text-[#d3c5ae]">
                Everything you need to know before purchasing.
              </p>
            </div>

            <Accordion type="single" collapsible className="space-y-3">
              {faqs.map((faq, i) => (
                <AccordionItem
                  key={i}
                  value={`faq-${i}`}
                  className="glass-card rounded-xl border-0 px-6 overflow-hidden"
                  data-testid={`accordion-faq-${i}`}
                >
                  <AccordionTrigger className="text-[#e5e2e1] font-semibold text-left hover:no-underline hover:text-[#ffd274] transition-colors py-5 text-base">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-[#d3c5ae] text-sm leading-relaxed pb-5">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* ── Final CTA Section ── */}
        <section className="px-6 md:px-8 py-32 bg-[#0e0e0e]/50">
          <div className="max-w-[800px] mx-auto text-center space-y-8">
            <div className="inline-flex items-center gap-2 bg-[#ffd274]/10 border border-[#ffd274]/20 px-4 py-1.5 rounded-full">
              <Award className="h-3.5 w-3.5 text-[#ffd274]" />
              <span className="text-xs font-bold tracking-widest uppercase text-[#ffd274]">
                Start Today
              </span>
            </div>

            <h2 className="text-[40px] md:text-[56px] font-extrabold leading-[1.1] tracking-[-0.03em] text-[#e5e2e1]">
              Give Your Athletes the{" "}
              <span className="text-[#ffd274]">Competitive Edge</span>
            </h2>

            <p className="text-lg text-[#d3c5ae] max-w-xl mx-auto leading-relaxed">
              The evidence-based training framework trusted by coaches and
              parents who refuse to leave athletic development to chance.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Button
                onClick={handlePurchaseCta}
                className="rounded-full bg-[#ffd274] text-[#402d00] hover:bg-[#ebb42d] font-bold text-sm tracking-widest uppercase px-12 py-7 text-base transition-all active:scale-95 shadow-[inset_0_0_12px_rgba(255,255,255,0.3)] hover:shadow-[0_0_60px_rgba(246,190,55,0.3)]"
                data-testid="button-final-cta-purchase"
              >
                Purchase Book
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>

            <p className="text-xs text-[#9c8f7a]">
              Available on Amazon · Includes 30-Day TrainChat Bonus
            </p>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="px-6 md:px-8 py-10 border-t border-white/5">
          <div className="max-w-[1200px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <TrainLogo className="h-4 w-4 text-[#ffd274]" />
              <span className="text-sm font-bold text-[#ffd274]">
                TrainEfficiency
              </span>
            </div>
            <p className="text-xs text-[#9c8f7a]">
              © {new Date().getFullYear()} TrainEfficiency. All rights
              reserved.
            </p>
            <div className="flex gap-6">
              <a
                href="/privacy"
                className="text-xs text-[#9c8f7a] hover:text-[#d3c5ae] transition-colors"
              >
                Privacy
              </a>
              <a
                href="/terms"
                className="text-xs text-[#9c8f7a] hover:text-[#d3c5ae] transition-colors"
              >
                Terms
              </a>
            </div>
          </div>
        </footer>
      </main>

      {/* ── Email Capture Modal ── */}
      <Dialog open={ctaModalOpen} onOpenChange={setCtaModalOpen}>
        <DialogContent className="bg-[#201f1f] border border-[#ffd274]/20 text-[#e5e2e1] max-w-md w-full">
          <DialogHeader>
            <DialogTitle className="text-[#ffd274] text-xl font-bold leading-snug">
              Claim Your Free Month of TrainChat
            </DialogTitle>
            <DialogDescription className="text-[#d3c5ae] text-sm leading-relaxed pt-1">
              Enter your email before heading to Amazon. After purchasing the
              book, you'll receive instructions to upload your receipt and
              redeem your free month of TrainChat.
            </DialogDescription>
          </DialogHeader>

          {/* Book context strip */}
          <div className="bg-[#131313] border border-white/10 rounded-xl p-4 flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-[#ffd274] shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-[#e5e2e1] text-sm truncate">
                The Structure of Training
              </p>
              <p className="text-xs text-[#9c8f7a]">
                Bryan Jones, MS, CSCS, PES, EP-C
              </p>
            </div>
            <div className="ml-auto flex items-center gap-1.5 text-[#ffd274] shrink-0">
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="text-xs font-bold uppercase tracking-wider whitespace-nowrap">
                +30 Days Free
              </span>
            </div>
          </div>

          <form onSubmit={handleModalSubmit} noValidate className="space-y-4 pt-1">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="book-first-name"
                  className="text-xs font-bold tracking-widest uppercase text-[#d3c5ae]"
                >
                  First Name <span className="text-[#ffd274]">*</span>
                </Label>
                <Input
                  id="book-first-name"
                  type="text"
                  autoComplete="given-name"
                  placeholder="Bryan"
                  value={form.firstName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, firstName: e.target.value }))
                  }
                  className={`bg-[#131313] border text-[#e5e2e1] placeholder:text-[#4f4634] focus-visible:ring-[#ffd274] focus-visible:border-[#ffd274] ${
                    errors.firstName
                      ? "border-red-500/60"
                      : "border-white/10"
                  }`}
                  data-testid="input-modal-first-name"
                  aria-required="true"
                  aria-describedby={errors.firstName ? "err-first-name" : undefined}
                />
                {errors.firstName && (
                  <p
                    id="err-first-name"
                    className="text-xs text-red-400"
                    role="alert"
                  >
                    {errors.firstName}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="book-last-name"
                  className="text-xs font-bold tracking-widest uppercase text-[#d3c5ae]"
                >
                  Last Name
                </Label>
                <Input
                  id="book-last-name"
                  type="text"
                  autoComplete="family-name"
                  placeholder="Jones"
                  value={form.lastName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, lastName: e.target.value }))
                  }
                  className="bg-[#131313] border border-white/10 text-[#e5e2e1] placeholder:text-[#4f4634] focus-visible:ring-[#ffd274] focus-visible:border-[#ffd274]"
                  data-testid="input-modal-last-name"
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label
                htmlFor="book-email"
                className="text-xs font-bold tracking-widest uppercase text-[#d3c5ae]"
              >
                Email Address <span className="text-[#ffd274]">*</span>
              </Label>
              <Input
                id="book-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
                className={`bg-[#131313] border text-[#e5e2e1] placeholder:text-[#4f4634] focus-visible:ring-[#ffd274] focus-visible:border-[#ffd274] ${
                  errors.email ? "border-red-500/60" : "border-white/10"
                }`}
                data-testid="input-modal-email"
                aria-required="true"
                aria-describedby={errors.email ? "err-email" : undefined}
              />
              {errors.email && (
                <p id="err-email" className="text-xs text-red-400" role="alert">
                  {errors.email}
                </p>
              )}
            </div>

            {/* Checkbox */}
            <div className="space-y-1.5">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="book-send-instructions"
                  checked={form.sendInstructions}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({
                      ...f,
                      sendInstructions: checked === true,
                    }))
                  }
                  className="mt-0.5 border-white/20 data-[state=checked]:bg-[#ffd274] data-[state=checked]:border-[#ffd274]"
                  data-testid="checkbox-modal-send-instructions"
                  aria-describedby={errors.sendInstructions ? "err-checkbox" : undefined}
                />
                <Label
                  htmlFor="book-send-instructions"
                  className="text-sm text-[#d3c5ae] leading-snug cursor-pointer"
                >
                  Send me instructions for redeeming my TrainChat bonus.{" "}
                  <span className="text-[#ffd274]">*</span>
                </Label>
              </div>
              {errors.sendInstructions && (
                <p
                  id="err-checkbox"
                  className="text-xs text-red-400 pl-7"
                  role="alert"
                >
                  {errors.sendInstructions}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 pt-2">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-full bg-[#ffd274] text-[#402d00] hover:bg-[#ebb42d] font-bold text-xs tracking-widest uppercase py-5 transition-all shadow-[inset_0_0_12px_rgba(255,255,255,0.3)] disabled:opacity-70"
                data-testid="button-modal-submit"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    Continue to Amazon
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-[#9c8f7a] text-xs hover:text-[#d3c5ae] hover:bg-transparent"
                onClick={() => setCtaModalOpen(false)}
                disabled={isSubmitting}
                data-testid="button-modal-maybe-later"
              >
                Maybe Later
              </Button>
            </div>

            <p className="text-xs text-[#9c8f7a] text-center pt-1">
              No spam. Redemption instructions only.{" "}
              {/* TODO: link to privacy policy once email backend is live */}
            </p>
          </form>
        </DialogContent>
      </Dialog>

      {/* Float animation keyframes */}
      <style>{`
        @keyframes subtle-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
        .glass-card {
          background: rgba(14, 14, 14, 0.7);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 210, 116, 0.1);
        }
      `}</style>
    </div>
  );
}

/* ── Sub-components ── */
function ValueCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div
      className="glass-card rounded-xl p-10 transition-all duration-500 hover:shadow-[0_0_40px_rgba(246,190,55,0.15)] hover:border-[#ffd274]/40"
      data-testid={`card-value-${title.replace(/\s/g, "-").toLowerCase()}`}
    >
      <div className="mb-6">{icon}</div>
      <h3 className="text-[28px] font-semibold leading-[1.3] text-[#e5e2e1] mb-4">
        {title}
      </h3>
      <p className="text-base text-[#d3c5ae] leading-relaxed">{description}</p>
    </div>
  );
}

/* ── Static data ── */
const previewChapters = [
  {
    title: "Adaptation: The Objective",
    excerpt:
      "Learn why adaptation—not fatigue—is the true objective of training and how every successful program should be designed around producing meaningful long-term physiological adaptations rather than simply making athletes tired.",
  },
  {
    title: "Stress: The Language of Adaptation",
    excerpt:
      "Explore how the body interprets mechanical, metabolic, and neurological stress to create adaptation, and why understanding stress is essential for designing effective training programs.",
  },
  {
    title: "Recovery: Where Adaptation Occurs",
    excerpt:
      "Discover why adaptation happens during recovery—not during the workout itself—and how sleep, nutrition, and proper recovery strategies determine long-term athletic development.",
  },
];

const testimonials = [
  {
    quote:
      "This book changed how I approach every single session. The periodization framework alone is worth ten times the price.",
    name: "Coach Marcus T.",
    role: "High School Track & Field Coach",
  },
  {
    quote:
      "Finally — a resource that balances the science with real, practical programming. My athletes have never felt stronger or moved faster.",
    name: "Sarah L.",
    role: "Athletic Director, Youth Sports Academy",
  },
  {
    quote:
      "As a parent I was skeptical, but this book gave me a clear framework I could actually understand and advocate for with my son's coaches.",
    name: "James R.",
    role: "Parent & Former Collegiate Athlete",
  },
];

const faqs = [
  {
    question: "Who is this book for?",
    answer:
      "This book is written for strength and conditioning coaches, physical education teachers, sports parents, and anyone responsible for the development of youth athletes. Whether you work with a single athlete or manage a full program, the frameworks inside apply at every level.",
  },
  {
    question: "How does the TrainChat bonus work?",
    answer:
      "After purchasing the book on Amazon, you'll upload your receipt at trainingefficiency.com/book/redeem to verify your purchase. Once verified, you'll receive the activation code TRAINCHAT — enter it at trainchat.ai to start your first month free.",
  },
  {
    question: "Does the book purchase happen through Amazon?",
    answer:
      "Yes. The book is sold through Amazon. Clicking 'Purchase Book' will take you to the Amazon listing to complete your order. The TrainChat bonus is redeemed separately through this site after purchase.",
  },
  {
    question: "How does receipt upload work?",
    answer:
      "Once you have your Amazon order confirmation email, you'll upload a screenshot or PDF of your receipt at /book/redeem. Our system verifies the purchase and your promo code is issued immediately on the confirmation page.",
  },
  {
    question: "Is this book available in digital format?",
    answer:
      "Physical and digital (Kindle) editions are available on Amazon. The TrainChat bonus applies to both formats — simply upload your receipt regardless of which edition you purchase.",
  },
  {
    question: "What if I already have a TrainChat subscription?",
    answer:
      "If you're already a TrainChat subscriber, your bonus month will be applied as a credit to your next billing cycle. No time is wasted.",
  },
];
