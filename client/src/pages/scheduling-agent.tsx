import { useEffect } from "react";
import { useLocation } from "wouter";
import { CoachSchedulingAgentPanel } from "@/components/coach-agent-panel";

export default function SchedulingAgentPage() {
  const [location] = useLocation();

  useEffect(() => {
    const resetScroll = () => {
      window.scrollTo({ top: 0, behavior: "auto" });
      const main = document.querySelector("main");
      if (main) main.scrollTop = 0;
    };

    resetScroll();
    const raf = requestAnimationFrame(resetScroll);
    const timer = setTimeout(resetScroll, 100);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [location]);

  return <CoachSchedulingAgentPanel mode="full" />;
}
