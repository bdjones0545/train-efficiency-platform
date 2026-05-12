import { useEffect, useState } from "react";
import { Calendar, DollarSign, Users, Mail, TrendingUp, Zap } from "lucide-react";

const nodes = [
  { id: "scheduling", label: "Scheduling", Icon: Calendar, cx: 80,  cy: 60  },
  { id: "payments",   label: "Payments",   Icon: DollarSign, cx: 240, cy: 18  },
  { id: "clients",    label: "Clients",    Icon: Users,      cx: 400, cy: 60  },
  { id: "leads",      label: "Leads",      Icon: Mail,       cx: 400, cy: 142 },
  { id: "revenue",    label: "Revenue",    Icon: TrendingUp, cx: 240, cy: 184 },
  { id: "followups",  label: "Follow-ups", Icon: Zap,        cx: 80,  cy: 142 },
];

const edges: [string, string][] = [
  ["scheduling", "payments"],
  ["payments",   "clients"],
  ["clients",    "leads"],
  ["leads",      "revenue"],
  ["revenue",    "followups"],
  ["followups",  "scheduling"],
  ["payments",   "revenue"],
  ["scheduling", "leads"],
];

function getNode(id: string) {
  return nodes.find((n) => n.id === id)!;
}

interface TravelDot {
  edgeIdx: number;
  progress: number;
  speed: number;
}

export default function LaserNodes() {
  const [dots, setDots] = useState<TravelDot[]>([]);
  const [activeNode, setActiveNode] = useState<string | null>(null);

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    setDots(
      edges.map((_, i) => ({
        edgeIdx: i,
        progress: (i / edges.length),
        speed: 0.0018 + Math.random() * 0.0012,
      }))
    );

    let raf: number;
    const tick = () => {
      setDots((prev) =>
        prev.map((d) => ({ ...d, progress: (d.progress + d.speed) % 1 }))
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));

  return (
    <div className="w-full flex justify-center select-none" aria-hidden="true">
      <div className="relative" style={{ width: 480, height: 204 }}>
        <svg
          width="480"
          height="204"
          viewBox="0 0 480 204"
          className="absolute inset-0"
          style={{ overflow: "visible" }}
        >
          <defs>
            <linearGradient id="beamGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="hsl(120 65% 42% / 0)" />
              <stop offset="50%" stopColor="hsl(120 65% 42% / 0.35)" />
              <stop offset="100%" stopColor="hsl(120 65% 42% / 0)" />
            </linearGradient>
            <filter id="nodeGlow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {edges.map(([fromId, toId], i) => {
            const a = nodeById[fromId];
            const b = nodeById[toId];
            return (
              <line
                key={i}
                x1={a.cx} y1={a.cy}
                x2={b.cx} y2={b.cy}
                stroke="hsl(120 65% 42% / 0.12)"
                strokeWidth="1"
                strokeDasharray="4 8"
              />
            );
          })}

          {dots.map((d, i) => {
            const [fromId, toId] = edges[d.edgeIdx];
            const a = nodeById[fromId];
            const b = nodeById[toId];
            const x = a.cx + (b.cx - a.cx) * d.progress;
            const y = a.cy + (b.cy - a.cy) * d.progress;
            return (
              <circle
                key={i}
                cx={x} cy={y} r={2}
                fill="hsl(120 65% 52%)"
                opacity={0.7}
                filter="url(#nodeGlow)"
              />
            );
          })}

          {nodes.map(({ id, cx, cy }) => (
            <circle
              key={id}
              cx={cx} cy={cy} r={16}
              fill="hsl(120 65% 42% / 0.06)"
              stroke={activeNode === id ? "hsl(120 65% 52% / 0.5)" : "hsl(120 65% 42% / 0.22)"}
              strokeWidth="1"
            />
          ))}
        </svg>

        {nodes.map(({ id, label, Icon, cx, cy }) => (
          <button
            key={id}
            onMouseEnter={() => setActiveNode(id)}
            onMouseLeave={() => setActiveNode(null)}
            className="absolute flex flex-col items-center gap-1 group"
            style={{
              left: cx - 28,
              top: cy - 28,
              width: 56,
              padding: 0,
              background: "none",
              border: "none",
              cursor: "default",
            }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300"
              style={{
                background:
                  activeNode === id
                    ? "hsl(120 65% 42% / 0.18)"
                    : "hsl(120 65% 42% / 0.08)",
                border: `1px solid ${
                  activeNode === id
                    ? "hsl(120 65% 52% / 0.45)"
                    : "hsl(120 65% 42% / 0.2)"
                }`,
                boxShadow:
                  activeNode === id
                    ? "0 0 10px hsl(120 65% 42% / 0.2)"
                    : "none",
              }}
            >
              <Icon
                style={{
                  width: 13,
                  height: 13,
                  color:
                    activeNode === id
                      ? "hsl(120 65% 55%)"
                      : "hsl(120 65% 42% / 0.7)",
                  transition: "color 0.3s",
                }}
              />
            </div>
            <span
              className="text-center leading-tight transition-colors duration-300"
              style={{
                fontSize: 9,
                letterSpacing: "0.04em",
                color:
                  activeNode === id
                    ? "hsl(120 65% 55%)"
                    : "hsl(120 65% 42% / 0.55)",
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
