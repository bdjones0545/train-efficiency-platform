import { TrainLogo } from "@/components/train-logo";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, Check, ExternalLink, ArrowLeft, Receipt } from "lucide-react";

// ── Analytics helpers ──────────────────────────────────────────────────────
function trackEvent(name: string, props?: Record<string, unknown>) {
  console.log(`[Analytics] ${name}`, props ?? {});
}

async function logFunnelEvent(eventType: string, email?: string, metadata?: Record<string, unknown>) {
  try {
    await fetch("/api/book-funnel/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email ?? undefined,
        eventType,
        metadata: { source: "book_bonus_success", ...(metadata ?? {}) },
      }),
    });
  } catch {
    // non-blocking
  }
}

// ── Promo code card ────────────────────────────────────────────────────────
function ActivationCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // fallback for older browsers
      const el = document.createElement("textarea");
      el.value = code;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    trackEvent("book_activation_code_copied");
    logFunnelEvent("book_activation_code_copied");
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div
      className="relative rounded-xl overflow-hidden text-left"
      style={{
        background: "rgba(26,26,26,0.7)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,210,116,0.12)",
        boxShadow: "0 0 64px 0 rgba(246,190,55,0.12)",
      }}
    >
      {/* Decorative top-right glow */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-[#ffd274]/5 rounded-full blur-[80px] -mr-24 -mt-24 pointer-events-none" />

      <div className="relative p-6 md:p-10 space-y-6">
        {/* Label */}
        <div>
          <p
            className="text-[10px] font-bold tracking-widest uppercase text-[#ffd274] mb-3"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            TrainChat Activation Code
          </p>

          {/* Code display + copy */}
          <div
            className="flex items-center justify-between bg-black/40 border border-[#4f4634] rounded-lg px-4 py-4 group hover:border-[#ffd274]/50 transition-colors cursor-pointer"
            onClick={handleCopy}
            data-testid="card-activation-code"
          >
            <span
              className="text-2xl md:text-3xl font-bold tracking-[0.15em] text-[#e5e2e1]"
              style={{ fontFamily: "'Space Grotesk', monospace" }}
              data-testid="text-promo-code"
            >
              {code}
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleCopy(); }}
              className={[
                "ml-4 shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-300 active:scale-90",
                copied
                  ? "bg-[#ffd274] text-[#402d00]"
                  : "text-[#ffd274] hover:bg-[#ffd274]/10",
              ].join(" ")}
              aria-label="Copy activation code"
              data-testid="button-copy-code"
            >
              {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>

          {copied && (
            <p className="text-xs text-[#ffd274] mt-2 text-center font-semibold tracking-wide" data-testid="text-copy-feedback">
              Copied to clipboard!
            </p>
          )}
        </div>

        {/* Helper text */}
        <p className="text-sm text-[#9c8f7a] leading-relaxed">
          Use this activation code during TrainChat checkout to receive your first month free.
        </p>

        {/* Primary CTA */}
        <div className="space-y-3">
          <a
            href="https://www.trainchat.ai"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              trackEvent("book_trainchat_clicked");
              logFunnelEvent("book_trainchat_clicked");
            }}
            className="w-full bg-[#ffd274] text-[#402d00] font-extrabold tracking-widest uppercase py-5 rounded-full flex items-center justify-center gap-3 shadow-[0_8px_32px_rgba(246,190,55,0.3)] hover:brightness-110 hover:scale-[1.01] active:scale-[0.98] transition-all duration-300"
            style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "12px" }}
            data-testid="link-activate-trainchat"
          >
            Activate TrainChat
            <ExternalLink className="w-4 h-4" />
          </a>
          <p
            className="text-center opacity-50 text-[#d3c5ae]"
            style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "10px", letterSpacing: "0.08em" }}
          >
            * NO CREDIT CARD REQUIRED FOR YOUR FIRST 30 DAYS
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function BookRedeemSuccessPage() {
  const searchParams = new URLSearchParams(window.location.search);
  const submissionId = searchParams.get("submissionId") ?? "";
  const emailRaw = searchParams.get("email") ?? "";
  const email = emailRaw ? decodeURIComponent(emailRaw) : "";
  // Every book lead receives the same static activation code.
  // promoCode from the URL is ignored — the code is always TRAINCHAT.
  const ACTIVATION_CODE = "TRAINCHAT";
  const [promoCode] = useState(ACTIVATION_CODE);
  const loadingCode = false;

  const hasTrackedView = useRef(false);

  // Track page view once
  useEffect(() => {
    if (hasTrackedView.current) return;
    hasTrackedView.current = true;
    trackEvent("book_bonus_unlocked_viewed", { email, submissionId });
    logFunnelEvent("book_bonus_unlocked_viewed", email || undefined, { submissionId });
  }, [email, submissionId]);

  const displayCode = promoCode || "TRAINCHAT";

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "#131313", color: "#e5e2e1", WebkitFontSmoothing: "antialiased" }}
    >
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header
        className="fixed top-0 w-full z-50 border-b"
        style={{
          background: "rgba(19,19,19,0.85)",
          backdropFilter: "blur(20px)",
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        <div className="flex justify-between items-center px-6 md:px-8 py-4 max-w-[1200px] mx-auto">
          <a
            href="/book"
            className="flex items-center gap-2 transition-transform active:scale-95"
            data-testid="link-success-nav-home"
          >
            <TrainLogo className="h-5 w-5 text-[#ffd274]" />
            <span className="font-bold text-lg text-[#ffd274] tracking-tight">TrainEfficiency</span>
          </a>
          <nav className="hidden md:flex gap-8 items-center">
            <a
              href="/book"
              className="text-[10px] font-bold tracking-widest uppercase text-[#9c8f7a] hover:text-[#ffd274] transition-colors"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Overview
            </a>
            <span
              className="text-[10px] font-bold tracking-widest uppercase text-[#ffd274] border-b-2 border-[#ffd274] pb-0.5"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Success
            </span>
          </nav>
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="flex-grow flex items-center justify-center pt-28 pb-24 px-5 md:px-8">
        <div className="max-w-[680px] w-full mx-auto text-center space-y-10">

          {/* Floating success icon */}
          <div className="flex justify-center">
            <div
              className="relative inline-block"
              style={{ animation: "subtle-float 6s ease-in-out infinite" }}
            >
              <div
                className="w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center"
                style={{
                  background: "rgba(255,210,116,0.08)",
                  border: "1px solid rgba(255,210,116,0.2)",
                  boxShadow: "0 0 64px 0 rgba(246,190,55,0.15)",
                }}
                data-testid="icon-success"
              >
                <CheckCircle2
                  className="text-[#ffd274]"
                  style={{ width: 64, height: 64, fill: "rgba(255,210,116,0.15)", color: "#ffd274" }}
                  strokeWidth={1.5}
                />
              </div>
              <div className="absolute -top-4 -right-4 w-8 h-8 bg-[#ffd274]/20 rounded-full blur-xl" />
              <div className="absolute -bottom-2 -left-6 w-12 h-12 bg-[#ffd274]/10 rounded-full blur-2xl" />
            </div>
          </div>

          {/* Badge + headline */}
          <div className="space-y-4">
            <div className="flex justify-center">
              <span
                className="inline-block px-4 py-1.5 rounded-full border text-[10px] font-bold tracking-widest uppercase text-[#ffd274]"
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  borderColor: "rgba(255,210,116,0.3)",
                  background: "rgba(255,210,116,0.05)",
                }}
                data-testid="badge-bonus-unlocked"
              >
                Bonus Unlocked
              </span>
            </div>

            <h1
              className="text-[36px] md:text-[52px] font-extrabold leading-[1.1] tracking-[-0.03em] text-[#e5e2e1]"
              data-testid="text-success-headline"
            >
              Your TrainChat Bonus Is Ready
            </h1>

            <p className="text-lg text-[#d3c5ae] max-w-xl mx-auto leading-relaxed" data-testid="text-success-body">
              Thanks for purchasing{" "}
              <strong className="text-[#e5e2e1]">
                The Structure of Training for Strength and Speed for Youth Athletes.
              </strong>{" "}
              We've received your purchase confirmation and your complimentary month of{" "}
              <strong className="text-[#ffd274]">TrainChat</strong> is ready to activate.
            </p>
          </div>

          {/* Activation code card */}
          {loadingCode ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 rounded-full border-2 border-[#ffd274]/30 border-t-[#ffd274] animate-spin" />
            </div>
          ) : (
            <ActivationCodeCard code={displayCode} />
          )}

          {/* Secondary actions */}
          <div className="flex flex-col md:flex-row items-center justify-center gap-6 pt-4">
            <a
              href="/book"
              className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-[#9c8f7a] hover:text-[#e5e2e1] transition-colors group"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              data-testid="link-return-to-train"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              Return to TrainEfficiency
            </a>

            <div className="hidden md:block h-4 w-px bg-[#4f4634]" />

            {submissionId ? (
              <a
                href={`/book/redeem?email=${encodeURIComponent(email)}`}
                className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-[#9c8f7a] hover:text-[#e5e2e1] transition-colors"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                data-testid="link-view-receipt"
              >
                View Uploaded Receipt
                <Receipt className="w-4 h-4" />
              </a>
            ) : (
              <span
                className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-[#4f4634] cursor-default"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                data-testid="link-view-receipt"
              >
                View Uploaded Receipt
                <Receipt className="w-4 h-4" />
              </span>
            )}
          </div>

          {/* Trust row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-6 border-t border-[#4f4634]/30">
            {[
              { emoji: "🔒", label: "Secure & Private" },
              { emoji: "⚡", label: "Instant Access" },
              { emoji: "🏆", label: "30 Days Free" },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-center gap-2 opacity-50">
                <span>{item.emoji}</span>
                <span
                  className="text-[10px] font-bold tracking-widest uppercase text-[#d3c5ae]"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="w-full py-16 border-t" style={{ background: "#0e0e0e", borderColor: "#4f4634" }}>
        <div className="max-w-[1200px] mx-auto px-6 md:px-8 grid grid-cols-1 md:grid-cols-2 gap-6 items-start md:items-center">
          <div>
            <p className="font-bold text-lg text-[#e5e2e1]">TrainEfficiency</p>
            <p className="text-sm text-[#9c8f7a] mt-1">
              © {new Date().getFullYear()} TrainEfficiency. All Rights Reserved. Evidence-Based Performance.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3 md:justify-end">
            {["Terms", "Privacy", "Support", "Contact"].map((link) => (
              <a
                key={link}
                href="#"
                className="text-sm text-[#9c8f7a] hover:text-[#e5e2e1] transition-colors opacity-80 hover:opacity-100"
              >
                {link}
              </a>
            ))}
          </div>
        </div>
      </footer>

      {/* Float animation */}
      <style>{`
        @keyframes subtle-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
    </div>
  );
}
