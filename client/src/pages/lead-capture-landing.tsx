import { useState, useEffect } from "react";
import { useParams } from "wouter";
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

type ProgramData = {
  org: { name: string; slug: string; logoUrl: string | null; primaryColor: string | null };
  program: { id: string; name: string; slug: string; type: string };
  config: {
    headline: string | null;
    subheadline: string | null;
    ctaText: string | null;
    heroImageUrl: string | null;
    benefits: { icon?: string; title: string; desc: string }[] | null;
    socialProof: { quote: string; name: string; sport?: string }[] | null;
    whoIsThisFor: string | null;
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

function StepCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 md:p-8 shadow-2xl ${className}`}>
      {children}
    </div>
  );
}

export default function LeadCaptureLanding() {
  const { orgSlug, programSlug } = useParams<{ orgSlug: string; programSlug: string }>();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [animDir, setAnimDir] = useState<"forward" | "back">("forward");
  const [submitted, setSubmitted] = useState(false);

  const TOTAL_STEPS = 5;

  const { data, isLoading, isError } = useQuery<ProgramData>({
    queryKey: [`/api/public/lead-capture/${orgSlug}/${programSlug}`],
    enabled: !!orgSlug && !!programSlug,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/public/lead-capture/${orgSlug}/${programSlug}/submit`, form)
        .then((r) => r.json()),
    onSuccess: () => {
      setSubmitted(true);
      setStep(TOTAL_STEPS);
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
  const headline = config?.headline || "Train Like an Elite Athlete";
  const subheadline = config?.subheadline || "Apply now and take the first step toward your athletic potential.";
  const ctaText = config?.ctaText || "Apply Now";
  const benefits: { icon?: string; title: string; desc: string }[] = Array.isArray(config?.benefits) && config.benefits.length > 0
    ? (config.benefits as { icon?: string; title: string; desc: string }[])
    : [
        { title: "Elite Coaching", desc: "Train with certified S&C specialists who've developed champions." },
        { title: "Proven Results", desc: "Athletes see measurable performance gains in 4-6 weeks." },
        { title: "Sport-Specific Programming", desc: "Every session is designed around your specific sport demands." },
        { title: "Athlete-First Culture", desc: "A community built on discipline, accountability, and growth." },
      ];
  const socialProof: { quote: string; name: string; sport?: string }[] = Array.isArray(config?.socialProof) && config.socialProof.length > 0
    ? (config.socialProof as { quote: string; name: string; sport?: string }[])
    : [
        { quote: "This program changed my game completely. I added 15 yards to my 40 time in 8 weeks.", name: "Marcus T.", sport: "Football" },
        { quote: "Best investment I've made in my athletic career. The coaches actually care.", name: "Jaylen R.", sport: "Basketball" },
        { quote: "My confidence on the field is through the roof. I got recruited after training here.", name: "Sofia M.", sport: "Soccer" },
      ];
  const whoIsThisFor = config?.whoIsThisFor || "";

  const defaultBenefitIcons = [<Zap key={0} />, <Target key={1} />, <Trophy key={2} />, <Shield key={3} />, <Flame key={4} />, <Star key={5} />];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* ── HERO ── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
        {config?.heroImageUrl ? (
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${config.heroImageUrl})` }}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/70 via-zinc-950/60 to-zinc-950" />
          </div>
        ) : (
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-orange-500/10 blur-[120px] translate-x-1/3 -translate-y-1/3" />
            <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-amber-500/10 blur-[100px] -translate-x-1/3 translate-y-1/3" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:60px_60px]" />
          </div>
        )}

        <div className="relative z-10 max-w-4xl mx-auto px-6 py-20 text-center flex flex-col items-center gap-8">
          {org.logoUrl && (
            <img src={org.logoUrl} alt={org.name} className="h-16 w-auto object-contain rounded-xl" data-testid="img-org-logo" />
          )}
          {!org.logoUrl && (
            <div className="inline-flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 rounded-full px-4 py-1.5">
              <Flame className="h-4 w-4 text-orange-400" />
              <span className="text-orange-400 text-sm font-semibold tracking-wide uppercase">{org.name}</span>
            </div>
          )}

          <div className="space-y-4">
            <h1
              className="text-4xl md:text-6xl lg:text-7xl font-black tracking-tight leading-none"
              data-testid="text-hero-headline"
              style={{
                background: "linear-gradient(135deg, #fff 0%, #fed7aa 50%, #fb923c 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {headline}
            </h1>
            <p className="text-lg md:text-xl text-white/70 max-w-2xl mx-auto leading-relaxed" data-testid="text-hero-subheadline">
              {subheadline}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4">
            <button
              onClick={() => document.getElementById("apply-form")?.scrollIntoView({ behavior: "smooth" })}
              className="group flex items-center gap-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white font-bold px-8 py-4 rounded-2xl text-lg transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-orange-500/30"
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

          <div className="flex flex-wrap items-center justify-center gap-6 pt-4">
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
            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 mb-4 text-xs tracking-widest uppercase">Athlete Results</Badge>
            <h2 className="text-3xl md:text-4xl font-black text-white">What Athletes Are Saying</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {socialProof.map((sp, i) => (
              <div
                key={i}
                className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 space-y-4 hover:border-orange-500/30 transition-colors"
                data-testid={`card-social-proof-${i}`}
              >
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-white/80 text-sm leading-relaxed italic">"{sp.quote}"</p>
                <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                  <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-xs">
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
            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 mb-4 text-xs tracking-widest uppercase">The Program</Badge>
            <h2 className="text-3xl md:text-4xl font-black text-white">Why Athletes Choose {org.name}</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {benefits.map((b, i) => (
              <div
                key={i}
                className="group flex items-start gap-4 bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 hover:border-orange-500/30 hover:bg-white/8 transition-all duration-300"
                data-testid={`card-benefit-${i}`}
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center text-orange-400 group-hover:bg-orange-500/30 transition-colors">
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
      {whoIsThisFor && (
        <section className="py-20 px-6 bg-gradient-to-r from-orange-500/10 via-transparent to-amber-500/10">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs tracking-widest uppercase">Is This For You?</Badge>
            <h2 className="text-3xl md:text-4xl font-black text-white">Who This Program Is For</h2>
            <div className="text-white/70 text-lg leading-relaxed whitespace-pre-line">{whoIsThisFor}</div>
          </div>
        </section>
      )}

      {!whoIsThisFor && (
        <section className="py-20 px-6 bg-gradient-to-r from-orange-500/10 via-transparent to-amber-500/10">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-10">
              <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 mb-4 text-xs tracking-widest uppercase">Is This For You?</Badge>
              <h2 className="text-3xl md:text-4xl font-black text-white">Built For Serious Athletes</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                "Athletes serious about next-level performance",
                "Student-athletes pursuing college recruitment",
                "Competitors who want an edge in their sport",
                "Athletes recovering and building back stronger",
                "Athletes ready to commit to the process",
                "Any age level — youth through college",
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-white/80">
                  <CheckCircle2 className="h-5 w-5 text-orange-400 flex-shrink-0" />
                  <span className="text-sm">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── MULTI-STEP FORM ── */}
      <section id="apply-form" className="py-20 px-6 bg-zinc-900/70">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 mb-4 text-xs tracking-widest uppercase">Application</Badge>
            <h2 className="text-3xl md:text-4xl font-black text-white">
              {submitted ? "You're In!" : `Apply to ${program.name}`}
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

            {/* SUCCESS */}
            {(step === 5 || submitted) && (
              <StepCard className="text-center">
                <div className="space-y-6 py-8">
                  <div className="relative inline-flex">
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-orange-500 to-amber-400 flex items-center justify-center mx-auto shadow-2xl shadow-orange-500/30">
                      <CheckCircle2 className="h-12 w-12 text-white" />
                    </div>
                    <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-green-400 flex items-center justify-center">
                      <Star className="h-4 w-4 text-white fill-white" />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-3xl font-black text-white" data-testid="text-success-headline">Application Submitted!</h3>
                    <p className="text-white/70 leading-relaxed max-w-sm mx-auto">
                      Your application to <strong className="text-orange-400">{program.name}</strong> has been received.
                      We'll be in touch within 24 hours.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-4 pt-4">
                    {[
                      { icon: <CheckCircle2 className="h-5 w-5" />, label: "Application Received" },
                      { icon: <Clock className="h-5 w-5" />, label: "Review in 24hrs" },
                      { icon: <Zap className="h-5 w-5" />, label: "Start Training Soon" },
                    ].map((item, i) => (
                      <div key={i} className="flex flex-col items-center gap-2 text-center">
                        <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400">
                          {item.icon}
                        </div>
                        <p className="text-white/60 text-xs leading-tight">{item.label}</p>
                      </div>
                    ))}
                  </div>
                  <a
                    href={`/org/${org.slug}`}
                    className="inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors mt-4"
                    data-testid="link-back-to-org"
                  >
                    View {org.name} →
                  </a>
                </div>
              </StepCard>
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
                className="flex-1 flex items-center justify-center gap-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 disabled:opacity-50 text-white font-bold h-14 rounded-xl text-base transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:shadow-orange-500/20"
                data-testid="button-next-step"
              >
                {submitMutation.isPending ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Submitting...
                  </>
                ) : step === 4 ? (
                  <>
                    Submit Application
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

      {/* ── STICKY CTA (mobile) ── */}
      {step === 1 && !submitted && (
        <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden px-4 pb-4 pt-2 bg-gradient-to-t from-zinc-950 to-transparent">
          <button
            onClick={() => document.getElementById("apply-form")?.scrollIntoView({ behavior: "smooth" })}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-bold py-4 rounded-2xl text-base shadow-2xl shadow-orange-500/30"
            data-testid="button-sticky-cta"
          >
            {ctaText}
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      )}

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
