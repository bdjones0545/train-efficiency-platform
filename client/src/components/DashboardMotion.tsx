/**
 * DashboardMotion — Premium "Laser Intelligence" motion system for admin/coach dashboards.
 *
 * Design philosophy: operational command-center precision. Data-driven clarity.
 * Authoritative · Intelligent · Precise · High-signal · Purposeful
 *
 * DO NOT use on:
 *  - Marketing / landing pages (use OrgMotion instead)
 *  - Client-facing portals (use ClientPortalMotion instead)
 *
 * Effects included:
 *  - Precision top-edge trace on command-center header
 *  - Staggered data-card entrance animations
 *  - Subtle priority breathing border on high-signal cards
 *  - Horizontal intel scan line on stat/insight cards
 *  - Live data pulse indicator (IntelPulseDot)
 *  - Row-level slide-from-right for list/feed items
 *  - Precise hover micro-interactions (y-lift, scale tap)
 *
 * All animations respect prefers-reduced-motion. GPU-accelerated only.
 */

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode, CSSProperties } from "react";

/* ─── shared easing ──────────────────────────────────────── */
const EASE_PRECISE = [0.25, 0.46, 0.45, 0.94] as const;
const EASE_SPRING  = [0.16, 1,    0.3,  1]     as const;

/* ─── viewport config ─────────────────────────────────────── */
const VP = { once: true, margin: "-40px" } as const;

/* ─── variant sets ────────────────────────────────────────── */
const FADE_DOWN: Variants = {
  hidden: { opacity: 0, y: -10 },
  show:   { opacity: 1, y: 0,  transition: { duration: 0.42, ease: EASE_PRECISE } },
};

const FADE_UP_DASH: Variants = {
  hidden: { opacity: 0, y: 14 },
  show:   { opacity: 1, y: 0,  transition: { duration: 0.44, ease: EASE_PRECISE } },
};

const STAGGER_PARENT: Variants = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.06, delayChildren: 0.02 } },
};

const STAGGER_CHILD_UP: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.978 },
  show:   { opacity: 1, y: 0,  scale: 1, transition: { duration: 0.38, ease: EASE_SPRING } },
};

const STAGGER_CHILD_RIGHT: Variants = {
  hidden: { opacity: 0, x: 10 },
  show:   { opacity: 1, x: 0,  transition: { duration: 0.34, ease: EASE_PRECISE } },
};

/* ═══════════════════════════════════════════════════════════════
   DashPageHeader
   Page title + subtitle area with a downward precision entrance
   and a thin top-edge trace line.
   ════════════════════════════════════════════════════════════ */
export function DashPageHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <div className={`relative ${className || ""}`}>
      {!reduced && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.22) 35%, hsl(var(--primary) / 0.22) 65%, transparent 100%)",
          }}
        />
      )}
      {reduced ? (
        <div>{children}</div>
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={FADE_DOWN}
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DashSectionReveal
   Fade + y-slide entrance triggered on scroll-into-view.
   Use to wrap each major page section (<section> elements).
   ════════════════════════════════════════════════════════════ */
export function DashSectionReveal({
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
      initial="hidden"
      whileInView="show"
      viewport={VP}
      variants={FADE_UP_DASH}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DashStaggerList
   Parent container — children stagger in on scroll-into-view.
   Use for card grids, list feeds, pipeline rows.
   ════════════════════════════════════════════════════════════ */
export function DashStaggerList({
  children,
  className,
  direction = "up",
  "data-testid": dataTestId,
}: {
  children: ReactNode;
  className?: string;
  direction?: "up" | "right";
  "data-testid"?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className} data-testid={dataTestId}>{children}</div>;

  return (
    <motion.div
      className={className}
      data-testid={dataTestId}
      initial="hidden"
      whileInView="show"
      viewport={VP}
      variants={STAGGER_PARENT}
      data-direction={direction}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DashStaggerItem
   Individual child inside DashStaggerList.
   direction="up"    → stat cards, grid items
   direction="right" → list/feed rows
   ════════════════════════════════════════════════════════════ */
export function DashStaggerItem({
  children,
  className,
  style,
  direction = "up",
  clickable = false,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  direction?: "up" | "right";
  clickable?: boolean;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className} style={style}>{children}</div>;

  const childVariants = direction === "right" ? STAGGER_CHILD_RIGHT : STAGGER_CHILD_UP;

  return (
    <motion.div
      className={className}
      style={style}
      variants={childVariants}
      {...(clickable
        ? {
            whileHover: { y: -1, transition: { duration: 0.15, ease: EASE_SPRING } },
            whileTap:   { scale: 0.988 },
          }
        : {})}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DashPriorityCard
   Wraps a high-signal card (Best Action, Top Priority, etc.)
   Adds a subtle breathing border-glow without being aggressive.
   ════════════════════════════════════════════════════════════ */
export function DashPriorityCard({
  children,
  className,
  variant = "primary",
}: {
  children: ReactNode;
  className?: string;
  variant?: "primary" | "orange";
}) {
  const reduced = useReducedMotion();

  const cls = `dash-priority-card ${variant === "orange" ? "dash-priority-card--orange" : ""} ${className || ""}`;

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={cls}
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VP}
      transition={{ duration: 0.46, ease: EASE_SPRING }}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DashStatCard
   Stat number card with a data-rise stagger entrance.
   Wrap individual Card components inside a DashStaggerList.
   scanLine=true adds the intel sweep effect.
   ════════════════════════════════════════════════════════════ */
export function DashStatCard({
  children,
  className,
  style,
  scanLine = false,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  scanLine?: boolean;
}) {
  const reduced = useReducedMotion();
  const cls = `${scanLine && !reduced ? "dash-intel-card" : ""} ${className || ""}`.trim();

  if (reduced) return <div className={cls} style={style}>{children}</div>;

  return (
    <motion.div
      className={cls}
      style={style}
      variants={STAGGER_CHILD_UP}
      whileHover={{ y: -1, transition: { duration: 0.15, ease: EASE_SPRING } }}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DashActionRow
   A self-contained list row (opportunity, slot, lead) with a
   scroll-triggered slide-from-right entrance and hover nudge.
   ════════════════════════════════════════════════════════════ */
export function DashActionRow({
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
      initial={{ opacity: 0, x: 10 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={VP}
      transition={{ duration: 0.34, ease: EASE_PRECISE }}
      whileHover={{ x: 1, transition: { duration: 0.12, ease: EASE_SPRING } }}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DashQuickActionGrid
   6-button quick action grid wrapper with stagger.
   ════════════════════════════════════════════════════════════ */
export function DashQuickActionGrid({
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
      variants={STAGGER_PARENT}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DashQuickActionItem
   Individual quick action button wrapper inside DashQuickActionGrid.
   ════════════════════════════════════════════════════════════ */
export function DashQuickActionItem({
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
      variants={STAGGER_CHILD_UP}
      whileHover={{ y: -2, transition: { duration: 0.16, ease: EASE_SPRING } }}
      whileTap={{ scale: 0.971 }}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   IntelPulseDot
   Live data indicator dot — primary/green for active data,
   orange for alerts, blue for AI activity, emerald for wins.
   ════════════════════════════════════════════════════════════ */
export function IntelPulseDot({
  className,
  color = "primary",
}: {
  className?: string;
  color?: "primary" | "orange" | "blue" | "emerald";
}) {
  const colorMap: Record<string, string> = {
    primary: "bg-primary",
    orange:  "bg-orange-500",
    blue:    "bg-blue-500",
    emerald: "bg-emerald-500",
  };
  const bg = colorMap[color];

  return (
    <span
      className={`relative flex h-2 w-2 flex-shrink-0 ${className || ""}`}
      aria-hidden="true"
    >
      <span className={`dash-pulse-ring absolute inline-flex h-full w-full rounded-full ${bg} opacity-60`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${bg}`} />
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DashAlertReveal
   Alert panel that slides from top on mount — use on system
   alert banners that appear conditionally.
   ════════════════════════════════════════════════════════════ */
export function DashAlertReveal({
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
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: EASE_PRECISE }}
    >
      {children}
    </motion.div>
  );
}
