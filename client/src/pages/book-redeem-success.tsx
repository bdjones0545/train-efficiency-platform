import { useEffect, useRef } from "react";
import { Dumbbell, CheckCircle2, Clock, Mail, ArrowRight } from "lucide-react";

function trackEvent(name: string, props?: Record<string, unknown>) {
  console.log(`[Analytics] ${name}`, props ?? {});
}

async function logFunnelEvent(eventType: string, email?: string) {
  try {
    await fetch("/api/book-funnel/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email ?? undefined,
        eventType,
        metadata: { source: "book_redeem_success" },
      }),
    });
  } catch {
    // non-blocking
  }
}

export default function BookRedeemSuccessPage() {
  const emailFromUrl = new URLSearchParams(window.location.search).get("email") ?? "";
  const email = emailFromUrl ? decodeURIComponent(emailFromUrl) : "";

  const hasTrackedView = useRef(false);

  useEffect(() => {
    if (hasTrackedView.current) return;
    hasTrackedView.current = true;
    trackEvent("book_redeem_success_viewed", { email });
    logFunnelEvent("book_redeem_success_viewed", email || undefined);
  }, [email]);

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] selection:bg-[#ffd274]/30 selection:text-[#ffd274]">
      {/* Nav */}
      <header className="fixed top-0 w-full z-50 bg-[#131313]/80 backdrop-blur-xl border-b border-white/10">
        <nav className="flex justify-between items-center px-6 md:px-8 py-4 max-w-[1200px] mx-auto">
          <a
            href="/book"
            className="flex items-center gap-2 transition-transform active:scale-95"
            data-testid="link-success-nav-home"
          >
            <Dumbbell className="h-5 w-5 text-[#ffd274]" />
            <span className="font-bold text-lg text-[#ffd274] tracking-tight">TrainEfficiency</span>
          </a>
        </nav>
      </header>

      <main className="pt-24 pb-32 px-5 md:px-8 flex items-start justify-center min-h-screen">
        <div className="max-w-[680px] w-full mx-auto mt-16">

          {/* Badge */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 bg-[#ffd274]/10 border border-[#ffd274]/20 px-4 py-1.5 rounded-full">
              <span
                className="text-[11px] font-bold tracking-widest uppercase text-[#ffd274]"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Receipt Received
              </span>
            </div>
          </div>

          {/* Big check */}
          <div className="flex justify-center mb-8">
            <div className="w-24 h-24 rounded-full bg-[#ffd274]/10 border-2 border-[#ffd274]/30 flex items-center justify-center shadow-[0_0_60px_rgba(246,190,55,0.15)]">
              <CheckCircle2 className="w-12 h-12 text-[#ffd274]" />
            </div>
          </div>

          {/* Headline */}
          <div className="text-center mb-10">
            <h1
              className="text-[40px] md:text-[52px] font-extrabold leading-[1.1] tracking-[-0.03em] text-[#e5e2e1] mb-4"
              data-testid="text-success-headline"
            >
              You're All Set!
            </h1>
            <p className="text-lg text-[#d3c5ae] max-w-md mx-auto leading-relaxed" data-testid="text-success-body">
              Your receipt has been received and is pending verification.
            </p>
          </div>

          {/* Status card */}
          <div
            className="bg-[#1c1b1b] border border-white/5 rounded-2xl p-8 md:p-10 shadow-[0_8px_48px_rgba(0,0,0,0.6)] relative overflow-hidden mb-8"
            style={{ boxShadow: "0 0 60px rgba(246,190,55,0.06), 0 8px 48px rgba(0,0,0,0.6)" }}
            data-testid="card-success-status"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#ffd274]/5 rounded-full blur-[100px] -mr-32 -mt-32 pointer-events-none" />

            <div className="space-y-8 relative">
              {/* Step: Receipt received */}
              <div className="flex gap-5 items-start">
                <div className="w-10 h-10 rounded-full bg-[#ffd274] text-[#402d00] flex items-center justify-center shrink-0 shadow-lg">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="pt-1">
                  <h3 className="text-[17px] font-bold text-[#e5e2e1] mb-1">Receipt Uploaded</h3>
                  <p className="text-sm text-[#9c8f7a]">Your file has been securely received and queued for review.</p>
                </div>
              </div>

              <div className="w-px h-6 bg-[#4f4634]/50 ml-5" />

              {/* Step: Manual review */}
              <div className="flex gap-5 items-start">
                <div className="w-10 h-10 rounded-full border-2 border-[#ffd274] text-[#ffd274] bg-[#ffd274]/10 flex items-center justify-center shrink-0 animate-pulse">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="pt-1">
                  <h3 className="text-[17px] font-bold text-[#ffd274] mb-1">Under Review</h3>
                  <p className="text-sm text-[#d3c5ae]">
                    Our team is verifying your Amazon purchase. This typically takes less than 24 hours.
                  </p>
                </div>
              </div>

              <div className="w-px h-6 bg-[#4f4634]/50 ml-5" />

              {/* Step: Activation */}
              <div className="flex gap-5 items-start">
                <div className="w-10 h-10 rounded-full border border-[#4f4634] text-[#9c8f7a] bg-[#1c1b1b] flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div className="pt-1">
                  <h3 className="text-[17px] font-bold text-[#e5e2e1] opacity-50 mb-1">TrainChat Activated</h3>
                  <p className="text-sm text-[#9c8f7a]">
                    {email
                      ? `Your access link will be sent to ${email} once approved.`
                      : "Your access link will be sent to your email once approved."}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* What's next info */}
          <div className="bg-[#1c1b1b] border border-white/5 border-l-4 border-l-[#ffd274]/40 rounded-xl p-6 mb-10">
            <h4
              className="text-[10px] font-bold tracking-widest uppercase text-[#ffd274] mb-3"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              What Happens Next?
            </h4>
            <ul className="space-y-2">
              {[
                "Our team reviews your receipt — usually within a few hours.",
                "Once verified, you'll receive a TrainChat access email.",
                "Click the link to activate your free month instantly.",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-[#d3c5ae]">
                  <span className="w-5 h-5 rounded-full bg-[#ffd274]/20 text-[#ffd274] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/book"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-transparent text-[#e5e2e1] hover:bg-[#2a2a2a] border border-white/10 font-bold text-sm tracking-widest uppercase px-10 py-4 transition-all active:scale-95"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              data-testid="link-back-to-book-success"
            >
              <ArrowRight className="w-4 h-4" />
              Back to Book Page
            </a>
          </div>

          {/* Trust row */}
          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 opacity-60 text-sm">
            {[
              { icon: "🔒", label: "Secure Processing" },
              { icon: "📧", label: "Email Notification" },
              { icon: "⚡", label: "Quick Activation" },
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
              <a key={link} href="#" className="text-sm text-[#9c8f7a] hover:text-[#e5e2e1] transition-colors">
                {link}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
