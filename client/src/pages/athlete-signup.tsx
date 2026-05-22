import { useEffect } from "react";
import { CheckCircle2, ArrowRight, Shield, Zap, Users, Trophy, ChevronLeft } from "lucide-react";

function useSearchParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    orgSlug: params.get("orgSlug") ?? "",
    submissionId: params.get("submissionId") ?? "",
    programId: params.get("programId") ?? "",
    programSlug: params.get("programSlug") ?? "",
    athleteName: params.get("athleteName") ?? "",
    email: params.get("email") ?? "",
    redirect: params.get("redirect") ?? "",
  };
}

export default function AthleteSignupPage() {
  const { orgSlug, submissionId, programId, programSlug, athleteName, email, redirect } = useSearchParams();

  const firstName = athleteName ? athleteName.split(" ")[0] : "Athlete";

  const returnPath = orgSlug
    ? `/org/${orgSlug}${submissionId ? `?submissionId=${submissionId}&linked=1` : ""}`
    : "/";

  const loginHref = `/api/auth/login?returnTo=${encodeURIComponent(returnPath)}`;

  const orgHref = orgSlug ? `/org/${orgSlug}` : "/";

  useEffect(() => {
    document.title = "Create Your Athlete Account";
  }, []);

  if (!orgSlug) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-white/60 text-sm">Missing organization context.</p>
          <a
            href="/"
            className="inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors"
            data-testid="link-go-home"
          >
            <ChevronLeft className="h-4 w-4" />
            Return Home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">

        {/* Header badge */}
        <div className="flex items-center justify-center">
          <div className="inline-flex items-center gap-2 bg-green-500/15 border border-green-500/30 rounded-full px-5 py-2">
            <CheckCircle2 className="h-4 w-4 text-green-400 fill-green-400/20" />
            <span className="text-green-300 text-sm font-semibold tracking-wide">Application Received</span>
          </div>
        </div>

        {/* Main card */}
        <div className="rounded-2xl border border-white/10 bg-zinc-900/80 backdrop-blur-xl p-6 md:p-8 space-y-6">

          {/* Progress steps */}
          <div className="flex items-center gap-0">
            {[
              { num: 1, label: "Applied", done: true },
              { num: 2, label: "Create Account", done: false, active: true },
              { num: 3, label: "Book Session", done: false },
            ].map((s, i) => (
              <div key={s.num} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    s.done
                      ? "bg-green-500 text-white shadow-lg shadow-green-500/40"
                      : s.active
                      ? "bg-white/10 border-2 border-green-500 text-green-400 ring-4 ring-green-500/20"
                      : "bg-white/5 border border-white/15 text-white/25"
                  }`}>
                    {s.done ? <CheckCircle2 className="h-4 w-4" /> : s.num}
                  </div>
                  <span className={`text-[10px] mt-1.5 font-medium tracking-wide ${
                    s.done ? "text-green-400" : s.active ? "text-white/80" : "text-white/25"
                  }`}>{s.label}</span>
                </div>
                {i < 2 && (
                  <div className={`h-px flex-1 mb-5 mx-1 ${s.done ? "bg-green-500/50" : "bg-white/10"}`} />
                )}
              </div>
            ))}
          </div>

          {/* Headline */}
          <div className="space-y-1.5 text-center">
            <h1 className="text-2xl font-black text-white" data-testid="text-signup-headline">
              Welcome, {firstName}!
            </h1>
            <p className="text-white/55 text-sm leading-relaxed max-w-xs mx-auto">
              Create your athlete account to track your application, access training resources, and lock in your evaluation session.
            </p>
          </div>

          {/* Benefits grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {[
              { icon: <Users className="h-3.5 w-3.5" />, text: "Track your application status" },
              { icon: <Zap className="h-3.5 w-3.5" />, text: "Access the athlete dashboard" },
              { icon: <Trophy className="h-3.5 w-3.5" />, text: "Book your evaluation session" },
              { icon: <Shield className="h-3.5 w-3.5" />, text: "Secure, private athlete profile" },
            ].map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-white/60 text-xs">
                <div className="w-5 h-5 rounded-full bg-green-500/15 flex items-center justify-center text-green-400 flex-shrink-0">
                  {b.icon}
                </div>
                {b.text}
              </div>
            ))}
          </div>

          {/* Primary CTA */}
          <a
            href={loginHref}
            className="group w-full flex items-center justify-center gap-3 bg-gradient-to-r from-green-500 to-emerald-400 hover:from-green-400 hover:to-emerald-300 text-white font-bold py-4 px-6 rounded-2xl text-base transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-green-500/25"
            data-testid="button-create-account-signup"
          >
            <CheckCircle2 className="h-5 w-5" />
            Create Account & Schedule
            <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
          </a>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/8" />
            <span className="text-white/25 text-xs">or</span>
            <div className="flex-1 h-px bg-white/8" />
          </div>

          {/* Fallback */}
          <a
            href={orgHref}
            className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/8 border border-white/10 text-white/50 hover:text-white/70 font-medium py-3.5 rounded-xl text-sm transition-all duration-200"
            data-testid="link-return-to-org"
          >
            <ChevronLeft className="h-4 w-4" />
            Return to Organization
          </a>

          {/* Sign-in hint */}
          <p className="text-center text-white/25 text-xs">
            Already have an account?{" "}
            <a
              href={loginHref}
              className="text-white/40 hover:text-white/60 underline underline-offset-2 transition-colors"
              data-testid="link-sign-in-existing"
            >
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
