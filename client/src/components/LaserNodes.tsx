import { useEffect, useRef, useState } from "react";
import { Calendar, DollarSign, Users, Mail, TrendingUp, Zap, LucideIcon } from "lucide-react";

/* ── node meta ─────────────────────────────────────── */
const NODE_META: Record<string, { label: string; Icon: LucideIcon }> = {
  scheduling: { label: "Scheduling", Icon: Calendar  },
  payments:   { label: "Payments",   Icon: DollarSign },
  clients:    { label: "Clients",    Icon: Users      },
  leads:      { label: "Leads",      Icon: Mail       },
  followups:  { label: "Follow-ups", Icon: Zap        },
  revenue:    { label: "Revenue",    Icon: TrendingUp },
};

/* ── desktop layout ─────────────────────────────────── */
const D_NODES = [
  { id: "scheduling", cx: 80,  cy: 60  },
  { id: "payments",   cx: 240, cy: 18  },
  { id: "clients",    cx: 400, cy: 60  },
  { id: "leads",      cx: 400, cy: 142 },
  { id: "revenue",    cx: 240, cy: 184 },
  { id: "followups",  cx: 80,  cy: 142 },
];
const D_EDGES: [string, string][] = [
  ["scheduling", "payments"],
  ["payments",   "clients"],
  ["clients",    "leads"],
  ["leads",      "revenue"],
  ["revenue",    "followups"],
  ["followups",  "scheduling"],
  ["payments",   "revenue"],
  ["scheduling", "leads"],
];
const D_BY_ID = Object.fromEntries(D_NODES.map((n) => [n.id, n]));

/* ── mobile layout  (300 × 164 viewbox, 2-col × 3-row) ── */
const M_POS: Record<string, { cx: number; cy: number }> = {
  scheduling: { cx: 60,  cy: 28  },
  payments:   { cx: 240, cy: 28  },
  clients:    { cx: 60,  cy: 80  },
  leads:      { cx: 240, cy: 80  },
  followups:  { cx: 60,  cy: 132 },
  revenue:    { cx: 240, cy: 132 },
};
const M_EDGES: [string, string][] = [
  ["scheduling", "payments"],
  ["clients",    "leads"],
  ["followups",  "revenue"],
  ["scheduling", "clients"],
  ["clients",    "followups"],
  ["payments",   "leads"],
  ["leads",      "revenue"],
];

/* ── dot state ─────────────────────────────────────── */
interface Dot { edgeIdx: number; progress: number; speed: number }

function makeDots(count: number, baseSpeed: number, jitter: number): Dot[] {
  return Array.from({ length: count }, (_, i) => ({
    edgeIdx: i,
    progress: i / count,
    speed: baseSpeed + Math.random() * jitter,
  }));
}

/* ── node appearance helper (pure style, no sub-component) ── */
function nodeStyle(active: boolean) {
  return {
    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: active ? "hsl(120 65% 42% / 0.18)" : "hsl(120 65% 42% / 0.08)",
    border: `1px solid ${active ? "hsl(120 65% 52% / 0.45)" : "hsl(120 65% 42% / 0.2)"}`,
    boxShadow: active ? "0 0 10px hsl(120 65% 42% / 0.2)" : "none",
    transition: "all 0.25s",
  } as React.CSSProperties;
}

function mobileNodeStyle(active: boolean) {
  return {
    width: 26, height: 26, borderRadius: 7, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: active ? "hsl(120 65% 42% / 0.18)" : "hsl(120 65% 42% / 0.08)",
    border: `1px solid ${active ? "hsl(120 65% 52% / 0.45)" : "hsl(120 65% 42% / 0.2)"}`,
    boxShadow: active ? "0 0 8px hsl(120 65% 42% / 0.18)" : "none",
    transition: "all 0.25s",
  } as React.CSSProperties;
}

function labelColor(active: boolean) {
  return active ? "hsl(120 65% 55%)" : "hsl(120 65% 42% / 0.55)";
}

/* ═══════════════════════════════════════════════════════ */

export default function LaserNodes() {
  const [dDots, setDDots] = useState<Dot[]>([]);
  const [mDots, setMDots] = useState<Dot[]>([]);
  const [hover, setHover]  = useState<string | null>(null);
  const raf = useRef<number>(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    setDDots(makeDots(D_EDGES.length, 0.0018, 0.0012));
    setMDots(makeDots(M_EDGES.length, 0.0022, 0.0015));

    const tick = () => {
      setDDots((prev) => prev.map((d) => ({ ...d, progress: (d.progress + d.speed) % 1 })));
      setMDots((prev) => prev.map((d) => ({ ...d, progress: (d.progress + d.speed) % 1 })));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  /* ── MOBILE ─────────────────────────────────────── */
  const mobileEl = (
    <div className="sm:hidden w-full flex justify-center px-4" aria-hidden="true">
      <div className="relative" style={{ width: 300, height: 164 }}>

        {/* SVG lines + dots */}
        <svg
          width="300" height="164" viewBox="0 0 300 164"
          className="absolute inset-0"
          style={{ overflow: "visible", pointerEvents: "none" }}
        >
          {M_EDGES.map(([a, b], i) => (
            <line key={i}
              x1={M_POS[a].cx} y1={M_POS[a].cy}
              x2={M_POS[b].cx} y2={M_POS[b].cy}
              stroke="hsl(120 65% 42% / 0.1)"
              strokeWidth="1" strokeDasharray="3 7"
            />
          ))}

          {mDots.map((d, i) => {
            const [a, b] = M_EDGES[d.edgeIdx];
            const x = M_POS[a].cx + (M_POS[b].cx - M_POS[a].cx) * d.progress;
            const y = M_POS[a].cy + (M_POS[b].cy - M_POS[a].cy) * d.progress;
            return <circle key={i} cx={x} cy={y} r={1.5} fill="hsl(120 65% 52%)" opacity={0.65} />;
          })}

          {Object.entries(M_POS).map(([id, { cx, cy }]) => (
            <circle key={id} cx={cx} cy={cy} r={13}
              fill="hsl(120 65% 42% / 0.04)"
              stroke={hover === id ? "hsl(120 65% 52% / 0.4)" : "hsl(120 65% 42% / 0.14)"}
              strokeWidth="1"
            />
          ))}
        </svg>

        {/* node icons + labels */}
        {Object.entries(M_POS).map(([id, { cx, cy }]) => {
          const { label, Icon } = NODE_META[id];
          const active = hover === id;
          return (
            <div
              key={id}
              className="absolute flex flex-col items-center"
              style={{ left: cx - 13, top: cy - 13, width: 26, gap: 2, cursor: "default" }}
              onMouseEnter={() => setHover(id)}
              onMouseLeave={() => setHover(null)}
            >
              <div style={mobileNodeStyle(active)}>
                <Icon style={{ width: 10, height: 10, color: active ? "hsl(120 65% 55%)" : "hsl(120 65% 42% / 0.7)", transition: "color 0.25s" }} />
              </div>
              <span style={{ fontSize: 7.5, letterSpacing: "0.03em", color: labelColor(active), fontWeight: 500, whiteSpace: "nowrap", transition: "color 0.25s", marginTop: 2 }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  /* ── DESKTOP ─────────────────────────────────────── */
  const desktopEl = (
    <div className="hidden sm:flex w-full justify-center select-none" aria-hidden="true">
      <div className="relative" style={{ width: 480, height: 204 }}>

        <svg
          width="480" height="204" viewBox="0 0 480 204"
          className="absolute inset-0"
          style={{ overflow: "visible" }}
        >
          <defs>
            <filter id="laserGlow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {D_EDGES.map(([a, b], i) => (
            <line key={i}
              x1={D_BY_ID[a].cx} y1={D_BY_ID[a].cy}
              x2={D_BY_ID[b].cx} y2={D_BY_ID[b].cy}
              stroke="hsl(120 65% 42% / 0.12)"
              strokeWidth="1" strokeDasharray="4 8"
            />
          ))}

          {dDots.map((d, i) => {
            const [a, b] = D_EDGES[d.edgeIdx];
            const x = D_BY_ID[a].cx + (D_BY_ID[b].cx - D_BY_ID[a].cx) * d.progress;
            const y = D_BY_ID[a].cy + (D_BY_ID[b].cy - D_BY_ID[a].cy) * d.progress;
            return <circle key={i} cx={x} cy={y} r={2} fill="hsl(120 65% 52%)" opacity={0.7} filter="url(#laserGlow)" />;
          })}

          {D_NODES.map(({ id, cx, cy }) => (
            <circle key={id} cx={cx} cy={cy} r={16}
              fill="hsl(120 65% 42% / 0.06)"
              stroke={hover === id ? "hsl(120 65% 52% / 0.5)" : "hsl(120 65% 42% / 0.22)"}
              strokeWidth="1"
            />
          ))}
        </svg>

        {D_NODES.map(({ id, cx, cy }) => {
          const { label, Icon } = NODE_META[id];
          const active = hover === id;
          return (
            <div
              key={id}
              className="absolute flex flex-col items-center"
              style={{ left: cx - 28, top: cy - 28, width: 56, gap: 4, cursor: "default" }}
              onMouseEnter={() => setHover(id)}
              onMouseLeave={() => setHover(null)}
            >
              <div style={nodeStyle(active)}>
                <Icon style={{ width: 13, height: 13, color: active ? "hsl(120 65% 55%)" : "hsl(120 65% 42% / 0.7)", transition: "color 0.25s" }} />
              </div>
              <span style={{ fontSize: 9, letterSpacing: "0.04em", color: labelColor(active), fontWeight: 500, whiteSpace: "nowrap", transition: "color 0.25s" }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {mobileEl}
      {desktopEl}
    </>
  );
}
