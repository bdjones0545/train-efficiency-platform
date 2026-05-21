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
  subtle:   { beam: 0.20, streak: 0.16, scan: 0.30, glow: 0.42 },
  standard: { beam: 0.34, streak: 0.26, scan: 0.48, glow: 0.62 },
  high:     { beam: 0.52, streak: 0.40, scan: 0.68, glow: 0.82 },
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
    @media (prefers-reduced-motion: no-preference) {
      @keyframes laser-scan {
        0%   { transform: translateY(-100%); opacity: 0; }
        5%   { opacity: 1; }
        95%  { opacity: 1; }
        100% { transform: translateY(2000%); opacity: 0; }
      }
      @keyframes laser-streak-1 {
        0%   { transform: translateX(-120%) skewX(-20deg); opacity: 0; }
        10%  { opacity: 1; }
        90%  { opacity: 1; }
        100% { transform: translateX(220%) skewX(-20deg); opacity: 0; }
      }
      @keyframes laser-streak-2 {
        0%   { transform: translateX(-120%) skewX(-15deg); opacity: 0; }
        15%  { opacity: 1; }
        85%  { opacity: 1; }
        100% { transform: translateX(220%) skewX(-15deg); opacity: 0; }
      }
      @keyframes laser-streak-3 {
        0%   { transform: translateX(-120%) skewX(-25deg); opacity: 0; }
        8%   { opacity: 1; }
        92%  { opacity: 1; }
        100% { transform: translateX(220%) skewX(-25deg); opacity: 0; }
      }
      @keyframes laser-glow-pulse {
        0%,100% { opacity: 0.6; transform: scale(1); }
        50%     { opacity: 1;   transform: scale(1.08); }
      }
      @keyframes laser-success-sweep {
        0%   { transform: translateX(-110%); opacity: 0; }
        8%   { opacity: 1; }
        92%  { opacity: 1; }
        100% { transform: translateX(110%); opacity: 0; }
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .laser-scan, .laser-streak-1, .laser-streak-2, .laser-streak-3,
      .laser-glow-pulse, .laser-success-sweep {
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

  if (variant === "success") {
    return (
      <div
        className={`absolute inset-0 pointer-events-none overflow-hidden rounded-2xl ${className}`}
        aria-hidden="true"
      >
        <div
          className="laser-success-sweep absolute top-1/2 left-0 right-0 h-px -translate-y-1/2"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${color}${Math.round(op.scan * 255).toString(16).padStart(2, "0")} 40%, ${color} 50%, ${color}${Math.round(op.scan * 255).toString(16).padStart(2, "0")} 60%, transparent 100%)`,
            boxShadow: `0 0 8px 2px ${color}${Math.round(op.scan * 0.6 * 255).toString(16).padStart(2, "0")}`,
            animation: "laser-success-sweep 1.4s cubic-bezier(0.4,0,0.2,1) 0.3s both",
          }}
        />
        <div
          className="laser-success-sweep absolute top-[45%] left-0 right-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${color}44 40%, ${color}88 50%, ${color}44 60%, transparent 100%)`,
            animation: "laser-success-sweep 1.4s cubic-bezier(0.4,0,0.2,1) 0.55s both",
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
            background: `linear-gradient(90deg, transparent 0%, ${color}${Math.round(op.beam * 1.5 * 255).toString(16).padStart(2, "0")} 30%, ${color}${Math.round(op.beam * 2 * 255).toString(16).padStart(2, "0")} 50%, ${color}${Math.round(op.beam * 1.5 * 255).toString(16).padStart(2, "0")} 70%, transparent 100%)`,
          }}
        />
      </div>
    );
  }

  // hero variant — full layered background effects
  const toHex2 = (n: number) => Math.round(Math.min(255, n * 255)).toString(16).padStart(2, "0");

  return (
    <div
      className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`}
      aria-hidden="true"
      style={{ zIndex: 2 }}
    >
      {/* Corner radial glow — top-left */}
      <div
        style={{
          position: "absolute",
          top: "-10%",
          left: "-10%",
          width: "55%",
          height: "55%",
          background: `radial-gradient(ellipse at 0% 0%, ${color}${toHex2(op.beam * 0.7)} 0%, transparent 70%)`,
          filter: "blur(8px)",
        }}
      />
      {/* Corner radial glow — bottom-right */}
      <div
        style={{
          position: "absolute",
          bottom: "-10%",
          right: "-10%",
          width: "50%",
          height: "50%",
          background: `radial-gradient(ellipse at 100% 100%, ${color}${toHex2(op.beam * 0.5)} 0%, transparent 70%)`,
          filter: "blur(12px)",
        }}
      />

      {/* Diagonal laser beam 1 — top-left to bottom-right (wide core + soft halo) */}
      <div
        style={{
          position: "absolute",
          top: "-10%",
          left: "-5%",
          width: "6px",
          height: "140%",
          background: `linear-gradient(180deg, transparent 0%, ${color}${toHex2(op.beam * 0.6)} 15%, ${color}${toHex2(op.beam)} 40%, ${color}${toHex2(op.beam)} 60%, ${color}${toHex2(op.beam * 0.6)} 85%, transparent 100%)`,
          transform: "rotate(25deg) translateX(120px)",
          filter: "blur(3px)",
          boxShadow: `0 0 12px 4px ${color}${toHex2(op.beam * 0.35)}`,
        }}
      />
      {/* Beam 1 tight core */}
      <div
        style={{
          position: "absolute",
          top: "-10%",
          left: "-5%",
          width: "2px",
          height: "140%",
          background: `linear-gradient(180deg, transparent 0%, ${color}${toHex2(op.beam * 0.8)} 20%, ${color} 50%, ${color}${toHex2(op.beam * 0.8)} 80%, transparent 100%)`,
          transform: "rotate(25deg) translateX(123px)",
          opacity: 0.9,
        }}
      />

      {/* Diagonal laser beam 2 — right side */}
      <div
        style={{
          position: "absolute",
          top: "-10%",
          right: "15%",
          width: "5px",
          height: "140%",
          background: `linear-gradient(180deg, transparent 0%, ${color}${toHex2(op.beam * 0.5)} 10%, ${color}${toHex2(op.beam * 0.85)} 50%, ${color}${toHex2(op.beam * 0.5)} 90%, transparent 100%)`,
          transform: "rotate(-18deg)",
          filter: "blur(3px)",
          boxShadow: `0 0 10px 3px ${color}${toHex2(op.beam * 0.25)}`,
        }}
      />

      {/* Diagonal laser beam 3 — center accent */}
      <div
        style={{
          position: "absolute",
          top: "-10%",
          left: "38%",
          width: "3px",
          height: "140%",
          background: `linear-gradient(180deg, transparent 0%, ${color}${toHex2(op.beam * 0.4)} 20%, ${color}${toHex2(op.beam * 0.7)} 55%, transparent 100%)`,
          transform: "rotate(8deg)",
          filter: "blur(2px)",
        }}
      />

      {/* Ambient wide beam — bottom-left glow plane */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "-20%",
          width: "80%",
          height: "60%",
          background: `conic-gradient(from 270deg at 30% 100%, ${color}${toHex2(op.beam * 0.55)} 0deg, transparent 45deg)`,
          filter: "blur(35px)",
        }}
      />

      {/* Moving light streaks */}
      <div
        className="laser-streak-1"
        style={{
          position: "absolute",
          top: "22%",
          left: 0,
          width: "35%",
          height: "1px",
          background: `linear-gradient(90deg, transparent 0%, ${color}${toHex2(op.streak)} 50%, transparent 100%)`,
          animation: "laser-streak-1 6s ease-in-out 0s infinite",
          filter: `blur(0.5px)`,
        }}
      />
      <div
        className="laser-streak-2"
        style={{
          position: "absolute",
          top: "55%",
          left: 0,
          width: "28%",
          height: "1px",
          background: `linear-gradient(90deg, transparent 0%, ${color}${toHex2(op.streak * 0.7)} 50%, transparent 100%)`,
          animation: "laser-streak-2 8s ease-in-out 2s infinite",
        }}
      />
      <div
        className="laser-streak-3"
        style={{
          position: "absolute",
          top: "38%",
          right: 0,
          width: "22%",
          height: "1px",
          background: `linear-gradient(270deg, transparent 0%, ${color}${toHex2(op.streak * 0.8)} 50%, transparent 100%)`,
          animation: "laser-streak-3 7s ease-in-out 4s infinite",
        }}
      />

      {/* Scanning line — sweeps slowly bottom of hero */}
      <div
        className="laser-scan"
        style={{
          position: "absolute",
          top: "65%",
          left: 0,
          right: 0,
          height: "1px",
          background: `linear-gradient(90deg, transparent 0%, ${color}${toHex2(op.scan * 0.3)} 15%, ${color}${toHex2(op.scan)} 50%, ${color}${toHex2(op.scan * 0.3)} 85%, transparent 100%)`,
          boxShadow: `0 0 6px 1px ${color}${toHex2(op.scan * 0.4)}`,
          animation: "laser-scan 12s linear 1s infinite",
        }}
      />

      {/* Bottom mask — prevents beams from covering the form area */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "30%",
          background: "linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 100%)",
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
  const toHex2 = (n: number) => Math.round(Math.min(255, n * 255)).toString(16).padStart(2, "0");

  return (
    <div
      className="laser-glow-pulse absolute inset-0 rounded-full pointer-events-none"
      aria-hidden="true"
      style={{
        boxShadow: `0 0 18px 4px ${color}${toHex2(op.glow)}, 0 0 40px 8px ${color}${toHex2(op.glow * 0.4)}`,
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
