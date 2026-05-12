/**
 * OrgMotion — Premium motion primitives for organization landing pages.
 * Athletic, clean, minimal. Uses Framer Motion + prefers-reduced-motion.
 * DO NOT import this on the main platform (TrainEfficiency) landing page.
 */
import { motion, useReducedMotion, type MotionProps, type Variants } from "framer-motion";
import type { ReactNode, CSSProperties } from "react";

/* ── shared easing ──────────────────────────────────────────── */
const EASE_OUT = [0.25, 0.46, 0.45, 0.94] as const;
const EASE_SMOOTH = [0.16, 1, 0.3, 1] as const;

/* ── variant sets ───────────────────────────────────────────── */
export const FADE_UP: Variants = {
  hidden: { opacity: 0, y: 22 },
  show:   { opacity: 1, y: 0,  transition: { duration: 0.52, ease: EASE_OUT } },
};

export const FADE_IN: Variants = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { duration: 0.5 } },
};

export const STAGGER_PARENT: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

export const STAGGER_CHILD: Variants = {
  hidden: { opacity: 0, y: 20 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.44, ease: EASE_OUT } },
};

export const STAGGER_CHILD_FAST: Variants = {
  hidden: { opacity: 0, y: 14 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT } },
};

/* default viewport options */
const VP = { once: true, margin: "-60px" } as const;

/* ── FadeUp ─────────────────────────────────────────────────── */
/**
 * Scroll-triggered fade + slide up. Wrap section headings and text blocks.
 */
export function FadeUp({
  children,
  delay = 0,
  className,
  style,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className} style={style}>{children}</div>;

  return (
    <motion.div
      className={className}
      style={style}
      initial="hidden"
      whileInView="show"
      viewport={VP}
      variants={FADE_UP}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

/* ── FadeIn ─────────────────────────────────────────────────── */
export function FadeIn({
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
      variants={FADE_IN}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

/* ── StaggerGrid ────────────────────────────────────────────── */
/**
 * Wrap a card grid. Each direct child will stagger in on scroll.
 */
export function StaggerGrid({
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

/* ── StaggerItem ────────────────────────────────────────────── */
export function StaggerItem({
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
      variants={STAGGER_CHILD}
    >
      {children}
    </motion.div>
  );
}

/* ── LiftCard ───────────────────────────────────────────────── */
/**
 * Hover: subtle 2px lift + soft shadow elevation.
 * Use on testimonial, program, coach cards.
 */
export function LiftCard({
  children,
  className,
  style,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  const reduced = useReducedMotion();
  if (reduced) {
    return (
      <div className={className} style={style} onClick={onClick}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={className}
      style={style}
      onClick={onClick}
      variants={STAGGER_CHILD}
      whileHover={{
        y: -3,
        transition: { duration: 0.22, ease: EASE_SMOOTH },
      }}
    >
      {children}
    </motion.div>
  );
}

/* ── AmbientCard ─────────────────────────────────────────────── */
/**
 * Feature card with hover precision border glow + lift.
 * Includes CSS ambient sweep via className.
 */
export function AmbientCard({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={`org-feature-card ${className || ""}`} style={style}>{children}</div>;

  return (
    <motion.div
      className={`org-feature-card ${className || ""}`}
      style={style}
      variants={STAGGER_CHILD}
      whileHover={{
        y: -2,
        transition: { duration: 0.2, ease: EASE_SMOOTH },
      }}
    >
      {children}
    </motion.div>
  );
}

/* ── SectionReveal ───────────────────────────────────────────── */
/**
 * Wraps an entire section with a gentle fade reveal.
 * Use on section tags or their direct content wrapper.
 */
export function SectionReveal({
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
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={VP}
      transition={{ duration: 0.6 }}
    >
      {children}
    </motion.div>
  );
}

/* ── HeroContent ─────────────────────────────────────────────── */
/**
 * Staggered hero entrance — children animate in sequence on mount.
 */
export function HeroContent({
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
      animate="show"
      variants={STAGGER_PARENT}
    >
      {children}
    </motion.div>
  );
}

/* ── HeroItem ────────────────────────────────────────────────── */
export function HeroItem({
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
      variants={{
        hidden: { opacity: 0, y: 18 },
        show:   { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT, delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

/* ── PulseBookingDot ─────────────────────────────────────────── */
/**
 * Small pulsing green indicator — signals live availability.
 * Place next to "Book a Session" buttons.
 */
export function PulseBookingDot({ className }: { className?: string }) {
  return (
    <span className={`relative flex h-2 w-2 flex-shrink-0 ${className || ""}`} aria-hidden="true">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-50" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
    </span>
  );
}
