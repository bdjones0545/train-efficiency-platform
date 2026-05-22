import { useEffect, useRef } from "react";

export type LaserPreset = "performance-orange" | "team-cyan" | "career-purple" | "elite-green";
export type LaserIntensity = "subtle" | "standard" | "high";

const PRESET_COLORS: Record<LaserPreset, string> = {
  "performance-orange": "#f97316",
  "team-cyan": "#06b6d4",
  "career-purple": "#a855f7",
  "elite-green": "#22c55e",
};

const INTENSITY_OPACITY: Record<LaserIntensity, { beam: number; streak: number; scan: number; glow: number }> = {
  subtle:   { beam: 0.28, streak: 0.22, scan: 0.42, glow: 0.55 },
  standard: { beam: 0.48, streak: 0.38, scan: 0.65, glow: 0.75 },
  high:     { beam: 0.68, streak: 0.54, scan: 0.84, glow: 0.92 },
};

interface LaserEffectsProps {
  enabled: boolean;
  intensity?: LaserIntensity;
  preset?: LaserPreset;
  accentColor?: string;
  variant?: "hero" | "success" | "divider";
  className?: string;
}

const CSS_ID = "laser-effects-keyframes";

function injectKeyframes() {
  if (typeof document === "undefined" || document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
    @keyframes laser-scan {
      0%   { transform: translateY(0px); opacity: 0; }
      4%   { opacity: 1; }
      96%  { opacity: 0.9; }
      100% { transform: translateY(1600px); opacity: 0; }
    }
    @keyframes laser-streak-1 {
      0%   { transform: translateX(-160%) skewX(-20deg); opacity: 0; }
      12%  { opacity: 1; }
      88%  { opacity: 1; }
      100% { transform: translateX(280%) skewX(-20deg); opacity: 0; }
    }
    @keyframes laser-streak-2 {
      0%   { transform: translateX(-160%) skewX(-15deg); opacity: 0; }
      18%  { opacity: 1; }
      82%  { opacity: 1; }
      100% { transform: translateX(280%) skewX(-15deg); opacity: 0; }
    }
    @keyframes laser-streak-3 {
      0%   { transform: translateX(-160%) skewX(-25deg); opacity: 0; }
      10%  { opacity: 1; }
      90%  { opacity: 1; }
      100% { transform: translateX(280%) skewX(-25deg); opacity: 0; }
    }
    @keyframes laser-glow-pulse {
      0%,100% { opacity: 0.7; transform: scale(1); }
      50%     { opacity: 1;   transform: scale(1.10); }
    }
    @keyframes laser-success-sweep {
      0%   { transform: translateX(-110%); opacity: 0; }
      8%   { opacity: 1; }
      92%  { opacity: 1; }
      100% { transform: translateX(110%); opacity: 0; }
    }
    @keyframes laser-cta-sweep {
      0%   { transform: translateX(-120%); opacity: 0; }
      10%  { opacity: 0.9; }
      90%  { opacity: 0.9; }
      100% { transform: translateX(120%); opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .laser-scan, .laser-streak-1, .laser-streak-2, .laser-streak-3,
      .laser-glow-pulse, .laser-success-sweep, .laser-cta-sweep {
        animation: none !important;
        opacity: 0 !important;
      }
    }
  `;
  document.head.appendChild(style);
}

export function LeadCaptureLaserEffects({
  enabled,
  intensity = "standard",
  preset = "performance-orange",
  accentColor,
  variant = "hero",
  className = "",
}: LaserEffectsProps) {
  useEffect(() => { injectKeyframes(); }, []);

  if (!enabled) return null;

  const color = accentColor || PRESET_COLORS[preset];
  const op = INTENSITY_OPACITY[intensity];
  const toHex2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, "0");

  if (variant === "success") {
    return (
      <div
        className={`absolute inset-0 pointer-events-none overflow-hidden rounded-2xl ${className}`}
        aria-hidden="true"
        style={{ zIndex: 2 }}
      >
        <div
          className="laser-success-sweep absolute top-1/2 left-0 right-0 h-px -translate-y-1/2"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${color}${toHex2(op.scan * 0.7)} 30%, ${color} 50%, ${color}${toHex2(op.scan * 0.7)} 70%, transparent 100%)`,
            boxShadow: `0 0 12px 3px ${color}${toHex2(op.scan * 0.5)}`,
            animation: "laser-success-sweep 1.4s cubic-bezier(0.4,0,0.2,1) 0.3s both",
          }}
        />
        <div
          className="laser-success-sweep absolute top-[46%] left-0 right-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${color}55 35%, ${color}99 50%, ${color}55 65%, transparent 100%)`,
            animation: "laser-success-sweep 1.4s cubic-bezier(0.4,0,0.2,1) 0.55s both",
          }}
        />
        <div
          className="laser-success-sweep absolute top-[54%] left-0 right-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${color}33 35%, ${color}66 50%, ${color}33 65%, transparent 100%)`,
            animation: "laser-success-sweep 1.4s cubic-bezier(0.4,0,0.2,1) 0.75s both",
          }}
        />
      </div>
    );
  }

  if (variant === "divider") {
    return (
      <div
        className={`relative w-full h-px overflow-hidden pointer-events-none ${className}`}
        aria-hidden="true"
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(90deg, transparent 0%, ${color}${toHex2(op.beam * 1.5)} 30%, ${color}${toHex2(op.beam * 2)} 50%, ${color}${toHex2(op.beam * 1.5)} 70%, transparent 100%)`,
          }}
        />
      </div>
    );
  }

  // ── hero variant ────────────────────────────────────────────────────────────
  return (
    <div
      className={`absolute inset-0 pointer-events-none ${className}`}
      aria-hidden="true"
      style={{ zIndex: 3, overflow: "hidden" }}
    >
      {/* ── Corner radial glow — top-left ────────────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "60%",
          height: "60%",
          background: `radial-gradient(ellipse at 0% 0%, ${color}${toHex2(op.beam * 0.9)} 0%, ${color}${toHex2(op.beam * 0.3)} 40%, transparent 70%)`,
          filter: "blur(6px)",
        }}
      />
      {/* ── Corner radial glow — bottom-right ───────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          width: "55%",
          height: "55%",
          background: `radial-gradient(ellipse at 100% 100%, ${color}${toHex2(op.beam * 0.7)} 0%, ${color}${toHex2(op.beam * 0.2)} 40%, transparent 70%)`,
          filter: "blur(10px)",
        }}
      />

      {/* ── Diagonal laser beam 1 — main (wide halo + tight core) ───────────── */}
      <div
        style={{
          position: "absolute",
          top: "5%",
          left: "8%",
          width: "8px",
          height: "130%",
          background: `linear-gradient(180deg, transparent 0%, ${color}${toHex2(op.beam * 0.7)} 10%, ${color}${toHex2(op.beam)} 35%, ${color}${toHex2(op.beam)} 65%, ${color}${toHex2(op.beam * 0.7)} 90%, transparent 100%)`,
          transform: "rotate(25deg)",
          filter: "blur(4px)",
          boxShadow: `0 0 18px 6px ${color}${toHex2(op.beam * 0.40)}`,
        }}
      />
      {/* Beam 1 tight core */}
      <div
        style={{
          position: "absolute",
          top: "5%",
          left: "8%",
          width: "2.5px",
          height: "130%",
          background: `linear-gradient(180deg, transparent 0%, ${color}${toHex2(op.beam * 0.9)} 15%, ${color} 45%, ${color} 55%, ${color}${toHex2(op.beam * 0.9)} 85%, transparent 100%)`,
          transform: "rotate(25deg) translateX(2.75px)",
          opacity: 0.95,
        }}
      />

      {/* ── Diagonal laser beam 2 — right side ──────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          top: "3%",
          right: "18%",
          width: "6px",
          height: "130%",
          background: `linear-gradient(180deg, transparent 0%, ${color}${toHex2(op.beam * 0.6)} 12%, ${color}${toHex2(op.beam * 0.9)} 45%, ${color}${toHex2(op.beam * 0.6)} 88%, transparent 100%)`,
          transform: "rotate(-18deg)",
          filter: "blur(4px)",
          boxShadow: `0 0 14px 4px ${color}${toHex2(op.beam * 0.30)}`,
        }}
      />
      {/* Beam 2 tight core */}
      <div
        style={{
          position: "absolute",
          top: "3%",
          right: "18%",
          width: "2px",
          height: "130%",
          background: `linear-gradient(180deg, transparent 0%, ${color}${toHex2(op.beam * 0.8)} 15%, ${color} 45%, ${color}${toHex2(op.beam * 0.8)} 85%, transparent 100%)`,
          transform: "rotate(-18deg) translateX(-1px)",
          opacity: 0.85,
        }}
      />

      {/* ── Diagonal laser beam 3 — center accent ───────────────────────────── */}
      <div
        style={{
          position: "absolute",
          top: "8%",
          left: "42%",
          width: "4px",
          height: "120%",
          background: `linear-gradient(180deg, transparent 0%, ${color}${toHex2(op.beam * 0.5)} 20%, ${color}${toHex2(op.beam * 0.8)} 55%, ${color}${toHex2(op.beam * 0.3)} 90%, transparent 100%)`,
          transform: "rotate(8deg)",
          filter: "blur(2.5px)",
          boxShadow: `0 0 8px 2px ${color}${toHex2(op.beam * 0.2)}`,
        }}
      />

      {/* ── Ambient wide beam — bottom-left glow plane ──────────────────────── */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "-10%",
          width: "75%",
          height: "55%",
          background: `conic-gradient(from 270deg at 25% 100%, ${color}${toHex2(op.beam * 0.65)} 0deg, transparent 40deg)`,
          filter: "blur(40px)",
        }}
      />

      {/* ── Moving light streaks ─────────────────────────────────────────────── */}
      <div
        className="laser-streak-1"
        style={{
          position: "absolute",
          top: "20%",
          left: 0,
          width: "40%",
          height: "2px",
          background: `linear-gradient(90deg, transparent 0%, ${color}${toHex2(op.streak * 0.5)} 20%, ${color}${toHex2(op.streak)} 55%, ${color}${toHex2(op.streak * 0.5)} 80%, transparent 100%)`,
          animation: "laser-streak-1 6s ease-in-out 0s infinite",
          filter: "blur(0.5px)",
          boxShadow: `0 0 4px 1px ${color}${toHex2(op.streak * 0.4)}`,
        }}
      />
      <div
        className="laser-streak-2"
        style={{
          position: "absolute",
          top: "52%",
          left: 0,
          width: "32%",
          height: "1.5px",
          background: `linear-gradient(90deg, transparent 0%, ${color}${toHex2(op.streak * 0.6)} 30%, ${color}${toHex2(op.streak * 0.8)} 55%, transparent 100%)`,
          animation: "laser-streak-2 8.5s ease-in-out 2.2s infinite",
        }}
      />
      <div
        className="laser-streak-3"
        style={{
          position: "absolute",
          top: "36%",
          right: 0,
          width: "28%",
          height: "1.5px",
          background: `linear-gradient(270deg, transparent 0%, ${color}${toHex2(op.streak * 0.7)} 35%, ${color}${toHex2(op.streak)} 60%, transparent 100%)`,
          animation: "laser-streak-3 7.2s ease-in-out 4.5s infinite",
          boxShadow: `0 0 4px 1px ${color}${toHex2(op.streak * 0.35)}`,
        }}
      />

      {/* ── Scanning line — sweeps from top to bottom ───────────────────────── */}
      <div
        className="laser-scan"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "2px",
          background: `linear-gradient(90deg, transparent 0%, ${color}${toHex2(op.scan * 0.35)} 12%, ${color}${toHex2(op.scan * 0.8)} 35%, ${color}${toHex2(op.scan)} 50%, ${color}${toHex2(op.scan * 0.8)} 65%, ${color}${toHex2(op.scan * 0.35)} 88%, transparent 100%)`,
          boxShadow: `0 0 8px 2px ${color}${toHex2(op.scan * 0.45)}, 0 0 20px 4px ${color}${toHex2(op.scan * 0.18)}`,
          animation: "laser-scan 10s linear 0.5s infinite",
        }}
      />

      {/* ── CTA area sweep glow ──────────────────────────────────────────────── */}
      <div
        className="laser-cta-sweep"
        style={{
          position: "absolute",
          top: "68%",
          left: 0,
          right: 0,
          height: "1px",
          background: `linear-gradient(90deg, transparent 0%, ${color}${toHex2(op.streak * 0.8)} 25%, ${color}${toHex2(op.streak)} 50%, ${color}${toHex2(op.streak * 0.8)} 75%, transparent 100%)`,
          boxShadow: `0 0 6px 2px ${color}${toHex2(op.streak * 0.3)}`,
          animation: "laser-cta-sweep 5s ease-in-out 3s infinite",
        }}
      />

      {/* ── Bottom fade — prevents hard clipping at form boundary ────────────── */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "25%",
          background: "linear-gradient(to top, rgba(0,0,0,0.35) 0%, transparent 100%)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

export function LaserUrgencyGlow({
  enabled,
  intensity = "standard",
  preset = "performance-orange",
  accentColor,
}: Pick<LaserEffectsProps, "enabled" | "intensity" | "preset" | "accentColor">) {
  useEffect(() => { injectKeyframes(); }, []);

  if (!enabled) return null;

  const color = accentColor || PRESET_COLORS[preset];
  const op = INTENSITY_OPACITY[intensity ?? "standard"];
  const toHex2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, "0");

  return (
    <div
      className="laser-glow-pulse absolute inset-0 rounded-full pointer-events-none"
      aria-hidden="true"
      style={{
        boxShadow: `0 0 22px 6px ${color}${toHex2(op.glow)}, 0 0 50px 12px ${color}${toHex2(op.glow * 0.35)}`,
        animation: "laser-glow-pulse 2.4s ease-in-out infinite",
        zIndex: 0,
      }}
    />
  );
}

export function getDefaultLaserPreset(funnelType: string): LaserPreset {
  if (funnelType === "team_training") return "team-cyan";
  if (funnelType === "employment_opportunity") return "career-purple";
  return "performance-orange";
}
