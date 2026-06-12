import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

interface ImpactItem {
  id: string;
  actionType: string;
  actionSource: string;
  prospectName: string | null;
  outcomeStatus: string;
  outcomeValue: number;
  timeToOutcomeHours?: number | null;
}

interface RevenueData {
  impactFeed: ImpactItem[];
}

function actionLabel(t: string) {
  const m: Record<string, string> = {
    send_follow_up: "Follow-up",
    generate_draft: "Draft",
    send_initial_email: "Initial email",
    create_deal: "Deal",
    generate_response: "Response",
    schedule_call: "Call",
    create_proposal: "Proposal",
  };
  return m[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatTime(h: number | null | undefined): string {
  if (h == null) return "";
  if (h < 1) return "< 1h";
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function triggerConfetti() {
  if (typeof window === "undefined") return;
  if (sessionStorage.getItem("ai_confetti_fired")) return;
  sessionStorage.setItem("ai_confetti_fired", "1");

  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) { document.body.removeChild(canvas); return; }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const COLORS = ["#22c55e", "#16a34a", "#4ade80", "#fbbf24", "#f59e0b", "#86efac", "#d4f5e2"];
  const particles = Array.from({ length: 72 }, () => ({
    x: Math.random() * W,
    y: -(Math.random() * 30 + 10),
    w: Math.random() * 9 + 4,
    h: Math.random() * 5 + 3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    vx: (Math.random() - 0.5) * 3.5,
    vy: Math.random() * 3.5 + 1.5,
    rot: Math.random() * 360,
    rotV: (Math.random() - 0.5) * 9,
  }));

  let frame = 0;
  const TOTAL = 110;

  function animate() {
    ctx!.clearRect(0, 0, W, H);
    const alpha = frame > 70 ? Math.max(0, 1 - (frame - 70) / 40) : 1;
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.rot += p.rotV;
      ctx!.save();
      ctx!.globalAlpha = alpha;
      ctx!.translate(p.x, p.y);
      ctx!.rotate((p.rot * Math.PI) / 180);
      ctx!.fillStyle = p.color;
      ctx!.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx!.restore();
    }
    frame++;
    if (frame < TOTAL) requestAnimationFrame(animate);
    else document.body.removeChild(canvas);
  }
  requestAnimationFrame(animate);
}

export function useAiRevenueToasts(
  showToast: (opts: { title: string; description: string; duration?: number }) => void
) {
  const initialized = useRef(false);
  const confettiFired = useRef(!!sessionStorage.getItem("ai_confetti_fired"));

  const { data } = useQuery<RevenueData>({
    queryKey: ["/api/email-agent/revenue-outcomes"],
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  useEffect(() => {
    if (!data?.impactFeed) return;

    const SEEN_KEY = "ai_rev_seen_v1";
    const seen = new Set<string>(
      JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]")
    );

    if (!initialized.current) {
      data.impactFeed.forEach(item => seen.add(item.id));
      sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen)));
      initialized.current = true;
      return;
    }

    const newItems = data.impactFeed.filter(
      item => item.outcomeStatus !== "pending" && !seen.has(item.id)
    );

    for (const item of newItems) {
      seen.add(item.id);
      const name = item.prospectName ?? "prospect";
      const actionBadge = actionLabel(item.actionType);
      const sourceBadge = item.actionSource === "auto_executed" ? " · Auto" : "";
      const timeBadge = item.timeToOutcomeHours != null
        ? ` · ${formatTime(item.timeToOutcomeHours)}` : "";

      if (item.outcomeStatus === "won") {
        showToast({
          title: `💰 AI generated $${item.outcomeValue.toLocaleString()}`,
          description: `${name} closed · ${actionBadge}${timeBadge}${sourceBadge}`,
          duration: 8000,
        });
        if (!confettiFired.current) {
          confettiFired.current = true;
          setTimeout(triggerConfetti, 400);
        }
        sessionStorage.setItem(
          "ai_recent_win",
          JSON.stringify({ prospectName: name, amount: item.outcomeValue, actionType: item.actionType })
        );
      } else if (item.outcomeStatus === "booked") {
        showToast({
          title: "Meeting booked — AI opened a deal",
          description: `${name} · ${actionBadge}${sourceBadge}`,
          duration: 6000,
        });
      } else if (item.outcomeStatus === "engaged") {
        showToast({
          title: "AI got a response!",
          description: `${name} replied · ${actionBadge}${sourceBadge}`,
          duration: 5000,
        });
      }
    }

    sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen)));
  }, [data?.impactFeed]);
}
