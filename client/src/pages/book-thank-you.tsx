import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dumbbell, CheckCircle2, ShoppingCart, ArrowLeft, Loader2 } from "lucide-react";

export const AMAZON_BOOK_URL = "https://amazon.com/TODO_BOOK_URL";

const IS_AMAZON_CONFIGURED = !AMAZON_BOOK_URL.includes("TODO");

const REDIRECT_DELAY_MS = 3000;

function trackEvent(name: string, props?: Record<string, unknown>) {
  console.log(`[Analytics] ${name}`, props ?? {});
}

async function logFunnelEvent(eventType: string, email?: string) {
  try {
    await apiRequest("POST", "/api/book-funnel/events", {
      email: email ?? undefined,
      eventType,
      metadata: { source: "book_thank_you" },
    });
  } catch {
    // non-blocking
  }
}

type Step = {
  label: string;
  done: boolean;
  active: boolean;
};

export default function BookThankYouPage() {
  const [, navigate] = useLocation();

  const emailParam = new URLSearchParams(window.location.search).get("email") ?? "";
  const email = emailParam ? decodeURIComponent(emailParam) : "";

  const [countdown, setCountdown] = useState(REDIRECT_DELAY_MS / 1000);
  const [redirected, setRedirected] = useState(false);
  const hasTrackedView = useRef(false);
  const hasTrackedRedirect = useRef(false);

  const steps: Step[] = [
    { label: "Email Saved", done: true, active: false },
    { label: "Continue to Amazon", done: false, active: true },
    { label: "Upload Receipt", done: false, active: false },
    { label: "Unlock TrainChat", done: false, active: false },
  ];

  useEffect(() => {
    if (hasTrackedView.current) return;
    hasTrackedView.current = true;
    trackEvent("book_thank_you_viewed", { email });
    logFunnelEvent("book_thank_you_viewed", email || undefined);
  }, [email]);

  useEffect(() => {
    if (!IS_AMAZON_CONFIGURED) {
      trackEvent("book_amazon_url_missing");
      logFunnelEvent("book_amazon_url_missing", email || undefined);
      return;
    }

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const timer = setTimeout(() => {
      if (!hasTrackedRedirect.current) {
        hasTrackedRedirect.current = true;
        trackEvent("book_amazon_auto_redirected", { email });
        logFunnelEvent("book_amazon_auto_redirected", email || undefined);
      }
      setRedirected(true);
      window.location.href = AMAZON_BOOK_URL;
    }, REDIRECT_DELAY_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [email]);

  function handleContinueToAmazon() {
    if (!IS_AMAZON_CONFIGURED) return;
    trackEvent("book_amazon_manual_clicked", { email });
    logFunnelEvent("book_amazon_manual_clicked", email || undefined);
    window.location.href = AMAZON_BOOK_URL;
  }

  function handleReturnToBook() {
    navigate("/book");
  }

  const progressPct = IS_AMAZON_CONFIGURED
    ? Math.max(0, Math.round(((REDIRECT_DELAY_MS / 1000 - countdown) / (REDIRECT_DELAY_MS / 1000)) * 100))
    : 0;

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] selection:bg-[#ffd274]/30 selection:text-[#ffd274]">
      {/* Nav */}
      <header className="fixed top-0 w-full z-50 bg-[#131313]/80 backdrop-blur-xl border-b border-white/10">
        <nav className="flex justify-between items-center px-6 md:px-8 py-4 max-w-[1200px] mx-auto">
          <a
            href="/book"
            className="flex items-center gap-2 transition-transform active:scale-95"
            data-testid="link-thankyou-nav-home"
          >
            <Dumbbell className="h-5 w-5 text-[#ffd274]" />
            <span className="font-bold text-lg text-[#ffd274] tracking-tight">
              TrainEfficiency
            </span>
          </a>
        </nav>
      </header>

      <main className="pt-24 pb-32 px-6 md:px-8 flex items-start justify-center min-h-screen">
        <div className="max-w-[720px] w-full mx-auto mt-16">

          {/* Badge */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 bg-[#ffd274]/10 border border-[#ffd274]/20 px-4 py-1.5 rounded-full">
              <span
                className="text-xs font-bold tracking-widest uppercase text-[#ffd274]"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Action Required
              </span>
            </div>
          </div>

          {/* Headline */}
          <div className="text-center mb-12">
            <h1 className="text-[40px] md:text-[56px] font-extrabold leading-[1.1] tracking-[-0.03em] text-[#e5e2e1] mb-4"
              data-testid="text-thankyou-headline"
            >
              One Last Step
            </h1>
            <p className="text-lg text-[#d3c5ae] max-w-lg mx-auto leading-relaxed">
              Your information has been saved. We're taking you to Amazon to
              complete your book purchase.
            </p>
          </div>

          {/* Progress Bar (only when Amazon is configured) */}
          {IS_AMAZON_CONFIGURED && !redirected && (
            <div className="mb-10">
              <div className="flex items-center justify-between text-xs text-[#9c8f7a] mb-2">
                <span
                  className="font-bold tracking-widest uppercase"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  Redirecting in {countdown}s…
                </span>
                <span>{progressPct}%</span>
              </div>
              <div className="w-full h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#ffd274] rounded-full transition-all duration-1000 ease-linear"
                  style={{ width: `${progressPct}%` }}
                  data-testid="progress-redirect-bar"
                />
              </div>
            </div>
          )}

          {redirected && (
            <div className="mb-10 flex items-center justify-center gap-2 text-[#ffd274]">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-medium">Redirecting to Amazon…</span>
            </div>
          )}

          {/* Stepper card */}
          <div
            className="bg-[#0e0e0e] border border-white/5 rounded-2xl p-8 md:p-12 shadow-[0_8px_48px_rgba(0,0,0,0.6)] relative overflow-hidden mb-8"
            data-testid="card-thankyou-steps"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#ffd274]/5 rounded-full blur-[100px] -mr-32 -mt-32 pointer-events-none" />

            <div className="space-y-10 relative">
              {steps.map((step, i) => (
                <div key={step.label} className="flex gap-6 items-start">
                  {/* Icon column */}
                  <div className="flex flex-col items-center shrink-0">
                    <div
                      className={[
                        "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                        step.done
                          ? "bg-[#ffd274] text-[#402d00] shadow-lg"
                          : step.active
                          ? "border-2 border-[#ffd274] text-[#ffd274] bg-[#ffd274]/10 animate-pulse"
                          : "border border-[#4f4634] text-[#9c8f7a]",
                      ].join(" ")}
                      data-testid={`step-icon-${i}`}
                    >
                      {step.done ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : step.active ? (
                        <ShoppingCart className="h-5 w-5" />
                      ) : (
                        <span className="text-sm font-bold">{i + 1}</span>
                      )}
                    </div>
                    {i < steps.length - 1 && (
                      <div className="w-px flex-1 min-h-[32px] bg-[#4f4634]/50 mt-3" />
                    )}
                  </div>

                  {/* Text column */}
                  <div className="pt-1 pb-4">
                    <h3
                      className={[
                        "text-[18px] font-bold leading-snug mb-1",
                        step.done
                          ? "text-[#e5e2e1] opacity-60"
                          : step.active
                          ? "text-[#ffd274]"
                          : "text-[#e5e2e1] opacity-50",
                      ].join(" ")}
                      data-testid={`step-label-${i}`}
                    >
                      {step.label}
                    </h3>
                    {step.done && (
                      <p className="text-sm text-[#9c8f7a]">
                        Your email has been confirmed.
                      </p>
                    )}
                    {step.active && (
                      <p className="text-sm text-[#d3c5ae]">
                        {IS_AMAZON_CONFIGURED
                          ? countdown > 0
                            ? `You'll be redirected automatically in ${countdown} second${countdown !== 1 ? "s" : ""}.`
                            : "Sending you to Amazon now…"
                          : "Amazon book URL not configured yet."}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Helper copy */}
          <p className="text-center text-sm text-[#9c8f7a] mb-8 max-w-md mx-auto leading-relaxed">
            After purchasing on Amazon, check your email for instructions to
            upload your receipt and redeem your free month of TrainChat.
          </p>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              onClick={handleContinueToAmazon}
              disabled={!IS_AMAZON_CONFIGURED}
              className="rounded-full bg-[#ffd274] text-[#402d00] hover:bg-[#ebb42d] font-bold text-sm tracking-widest uppercase px-10 py-6 transition-all active:scale-95 shadow-[inset_0_0_12px_rgba(255,255,255,0.3)] hover:shadow-[0_0_40px_rgba(246,190,55,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
              data-testid="button-continue-amazon"
            >
              <ShoppingCart className="mr-2 h-4 w-4" />
              Continue to Amazon
            </Button>

            <Button
              variant="outline"
              onClick={handleReturnToBook}
              className="rounded-full bg-transparent text-[#e5e2e1] hover:bg-[#2a2a2a] border border-white/10 font-bold text-sm tracking-widest uppercase px-10 py-6 transition-all active:scale-95"
              data-testid="button-return-book"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Return to Book Page
            </Button>
          </div>

          {/* Trust row */}
          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 opacity-60 text-sm">
            {[
              { icon: "🔒", label: "Secure Verification" },
              { icon: "⚡", label: "Instant Activation" },
              { icon: "💬", label: "24/7 Priority Support" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 justify-center md:justify-start">
                <span className="text-base">{item.icon}</span>
                <span className="font-semibold text-[#d3c5ae]">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-16 bg-[#0e0e0e] border-t border-[#4f4634]">
        <div className="max-w-[1200px] mx-auto px-6 md:px-8 flex flex-col md:flex-row justify-between gap-6 items-start md:items-center">
          <div>
            <p className="font-bold text-lg text-[#e5e2e1]">TrainEfficiency</p>
            <p className="text-sm text-[#9c8f7a] mt-1">
              © 2024 TrainEfficiency. All Rights Reserved. Evidence-Based Performance.
            </p>
          </div>
          <div className="flex gap-8">
            {["Terms", "Privacy", "Support"].map((link) => (
              <a
                key={link}
                href="#"
                className="text-sm text-[#9c8f7a] hover:text-[#e5e2e1] transition-colors"
              >
                {link}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
