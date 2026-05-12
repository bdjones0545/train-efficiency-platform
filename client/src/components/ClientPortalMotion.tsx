/**
 * ClientPortalMotion — Premium motion primitives for logged-in client portals.
 *
 * Design philosophy: elite coaching experience powered by invisible technology.
 * Calm · Athletic · Professional · Trustworthy · Performance-oriented
 *
 * DO NOT use on:
 *  - Marketing / landing pages (use OrgMotion instead)
 *  - Coach / admin dashboards
 *  - AI command-center views
 *
 * Effects included:
 *  - Faint animated background grid (header/hero only)
 *  - Soft edge-tracing on premium cards
 *  - Ambient light sweep across cards
 *  - Gentle CTA glow on booking / payment buttons
 *  - Small pulse indicators for upcoming sessions / messages
 *  - Smooth hover/tap micro-interactions via Framer Motion
 *  - Soft focus glow on active sections
 *
 * All animations respect prefers-reduced-motion and pause on rapid scroll.
 * GPU-accelerated: uses transform and opacity only (no width/height changes).
 */

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode, CSSProperties } from "react";

/* ─── shared easing ─────────────────────────────────────────── */
const EASE_OUT  = [0.25, 0.46, 0.45, 0.94] as const;
const EASE_SOFT = [0.16, 1, 0.3, 1]         as const;

/* ─── variant sets ──────────────────────────────────────────── */
const FADE_UP_PORTAL: Variants = {
  hidden: { opacity: 0, y: 18 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.48, ease: EASE_OUT } },
};

const STAGGER_PARENT_PORTAL: Variants = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
};

const STAGGER_CHILD_PORTAL: Variants = {
  hidden: { opacity: 0, y: 16 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE_OUT } },
};

const VP = { once: true, margin: "-48px" } as const;

/* ═══════════════════════════════════════════════════════════════
   PortalHeroGrid
   Faint animated dot/line grid — use ONLY in the dashboard
   hero header area. Never behind readable content.
   ════════════════════════════════════════════════════════════ */
export function PortalHeroGrid({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`portal-hero-grid pointer-events-none select-none ${className || ""}`}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════
   PortalPageHero
   Hero / header banner for CLIENT pages.
   Contains the faint grid overlay and entrance animation.
   ════════════════════════════════════════════════════════════ */
export function PortalPageHero({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <div className={`relative overflow-hidden ${className || ""}`}>
      {!reduced && (
        <div
          aria-hidden="true"
          className="portal-hero-grid absolute inset-0 pointer-events-none z-0"
        />
      )}
      <div
        className="absolute inset-x-0 top-0 h-px pointer-events-none z-10"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.18) 40%, hsl(var(--primary) / 0.18) 60%, transparent 100%)",
        }}
        aria-hidden="true"
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PortalFadeUp
   Scroll-triggered fade + slide up entrance.
   ════════════════════════════════════════════════════════════ */
export function PortalFadeUp({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={VP}
      variants={FADE_UP_PORTAL}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PortalStaggerGrid
   Wraps a card grid — children stagger in on mount/scroll.
   ════════════════════════════════════════════════════════════ */
export function PortalStaggerGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={VP}
      variants={STAGGER_PARENT_PORTAL}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PortalStaggerItem
   Individual child inside PortalStaggerGrid.
   ════════════════════════════════════════════════════════════ */
export function PortalStaggerItem({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className} style={style}>{children}</div>;

  return (
    <motion.div
      className={className}
      style={style}
      variants={STAGGER_CHILD_PORTAL}
      whileHover={{
        y: -2,
        transition: { duration: 0.18, ease: EASE_SOFT },
      }}
      whileTap={{ scale: 0.985 }}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PremiumCard
   Card with slow ambient sweep + soft top-edge trace.
   Use on: Upcoming Session cards, Coach cards, Progress cards.
   ════════════════════════════════════════════════════════════ */
export function PremiumCard({
  children,
  className,
  style,
  glowOnHover = false,
  "data-testid": dataTestId,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  glowOnHover?: boolean;
  "data-testid"?: string;
}) {
  const reduced = useReducedMotion();

  const baseClass = `portal-premium-card ${glowOnHover ? "portal-card-hover-glow" : ""} ${className || ""}`;

  if (reduced) {
    return (
      <div className={baseClass} style={style} data-testid={dataTestId}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={baseClass}
      style={style}
      data-testid={dataTestId}
      whileHover={{
        y: -2,
        transition: { duration: 0.2, ease: EASE_SOFT },
      }}
      whileTap={{ scale: 0.992 }}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   UpcomingSessionCard
   Session card with edge-trace highlight + pulse indicator slot.
   ════════════════════════════════════════════════════════════ */
export function UpcomingSessionCard({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion();

  const cls = `portal-session-card ${className || ""}`;

  if (reduced) return <div className={cls} style={style}>{children}</div>;

  return (
    <motion.div
      className={cls}
      style={style}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VP}
      transition={{ duration: 0.44, ease: EASE_OUT }}
      whileHover={{
        y: -2,
        transition: { duration: 0.18, ease: EASE_SOFT },
      }}
      whileTap={{ scale: 0.992 }}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   WalletGlowCard
   Wallet / balance card with slow ambient breathe glow.
   ════════════════════════════════════════════════════════════ */
export function WalletGlowCard({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion();

  const cls = `portal-wallet-card ${className || ""}`;

  if (reduced) return <div className={cls} style={style}>{children}</div>;

  return (
    <motion.div
      className={cls}
      style={style}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BookingCTAWrap
   Wraps a booking/payment CTA button with a gentle glow halo.
   ════════════════════════════════════════════════════════════ */
export function BookingCTAWrap({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`portal-cta-wrap ${className || ""}`}>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SessionPulseDot
   Small pulsing indicator — use next to upcoming sessions or
   unread coach message counts.
   ════════════════════════════════════════════════════════════ */
export function SessionPulseDot({ className }: { className?: string }) {
  return (
    <span
      className={`relative flex h-2 w-2 flex-shrink-0 ${className || ""}`}
      aria-hidden="true"
    >
      <span className="portal-pulse-ring absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MessagePulseDot
   Amber/orange pulse for coach message notifications.
   ════════════════════════════════════════════════════════════ */
export function MessagePulseDot({ className }: { className?: string }) {
  return (
    <span
      className={`relative flex h-2 w-2 flex-shrink-0 ${className || ""}`}
      aria-hidden="true"
    >
      <span className="portal-pulse-ring absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PortalSectionReveal
   Gentle fade-in for page sections as they scroll into view.
   ════════════════════════════════════════════════════════════ */
export function PortalSectionReveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={VP}
      transition={{ duration: 0.55, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PortalFocusSection
   Soft ambient focus glow applied around an active/featured section.
   ════════════════════════════════════════════════════════════ */
export function PortalFocusSection({
  children,
  className,
  active = false,
}: {
  children: ReactNode;
  className?: string;
  active?: boolean;
}) {
  return (
    <div
      className={`portal-focus-section ${active ? "portal-focus-active" : ""} ${className || ""}`}
    >
      {children}
    </div>
  );
}
