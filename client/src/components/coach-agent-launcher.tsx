import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Bot } from "lucide-react";
import { CoachSchedulingAgentPanel, type AgentContext, type SourcePage, type OpsDigest } from "@/components/coach-agent-panel";

function getSourcePage(path: string): SourcePage {
  if (path.startsWith("/admin/media")) return "media";
  if (path.startsWith("/scheduling") || path.startsWith("/coach/availability")) return "schedule";
  if (path.startsWith("/coach/users") || path.includes("clients")) return "clients";
  if (path.startsWith("/coach/transactions") || path.startsWith("/coach/business-plan")) return "revenue";
  if (path.startsWith("/admin/configuration") || path.startsWith("/admin/branding") || path.startsWith("/admin/stripe")) return "settings";
  if (path.startsWith("/admin")) return "settings";
  if (path.startsWith("/coach")) return "dashboard";
  return "dashboard";
}

function getBadgeInfo(digest: OpsDigest | undefined): { label: string; urgent: boolean } | null {
  if (!digest) return null;

  const highPriority = digest.insights.filter(i => i.priority === "high").length;
  if (highPriority > 0) {
    return { label: String(highPriority), urgent: true };
  }

  if (digest.inactiveClientsCount > 0) {
    return { label: "!", urgent: false };
  }

  if (digest.estimatedOpenRevenue > 0) {
    const fmt = digest.estimatedOpenRevenue >= 1000
      ? `$${(digest.estimatedOpenRevenue / 1000).toFixed(0)}k`
      : `$${digest.estimatedOpenRevenue}`;
    return { label: fmt, urgent: false };
  }

  return null;
}

export function CoachAgentLauncher() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [hasPulsed, setHasPulsed] = useState(false);
  const pulsedRef = useRef(false);

  const { data: profile } = useQuery<{ role?: string }>({ queryKey: ["/api/profile"] });
  const userRole = profile?.role || "CLIENT";
  const isStaff = userRole === "COACH" || userRole === "ADMIN" || userRole === "STAFF";

  const { data: digest } = useQuery<OpsDigest>({
    queryKey: ["/api/scheduling/operations-digest"],
    enabled: isStaff,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  const badge = getBadgeInfo(digest);

  useEffect(() => {
    if (badge?.urgent && !pulsedRef.current) {
      pulsedRef.current = true;
      setHasPulsed(true);
      const t = setTimeout(() => setHasPulsed(false), 2000);
      return () => clearTimeout(t);
    }
  }, [badge?.urgent]);

  const onDrawerClose = () => {
    setOpen(false);
  };

  const isOnAgentPage = location === "/scheduling/agent";

  if (!isStaff || isOnAgentPage) return null;

  const sourcePage = getSourcePage(location);
  const context: AgentContext = {
    sourcePage,
    sourcePath: location,
    openedAt: Date.now(),
  };

  return (
    <>
      {/* Floating launcher button */}
      <button
        data-testid="coach-agent-launcher"
        aria-label="Open scheduling agent"
        onClick={() => setOpen(true)}
        className={[
          "fixed z-50 flex items-center justify-center rounded-full shadow-lg",
          "bg-primary text-primary-foreground",
          "transition-transform hover:scale-105 active:scale-95",
          "bottom-6 right-5",
          "w-13 h-13",
          hasPulsed ? "animate-[pulse_0.8s_ease-in-out_2]" : "",
        ].join(" ")}
        style={{
          width: 52,
          height: 52,
          bottom: `max(5rem, calc(env(safe-area-inset-bottom) + 4.5rem))`,
          right: "1.25rem",
        }}
      >
        <Bot className="h-6 w-6" />
        {badge && (
          <span
            data-testid="agent-launcher-badge"
            className={[
              "absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full px-1",
              "flex items-center justify-center",
              "text-[10px] font-bold leading-none",
              badge.urgent
                ? "bg-red-500 text-white"
                : "bg-orange-400 text-white",
            ].join(" ")}
          >
            {badge.label}
          </span>
        )}
      </button>

      {/* Overlay — full screen on mobile, right-side drawer on desktop */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className={[
            "p-0 flex flex-col",
            "w-full sm:w-[460px]",
            "h-[100dvh]",
            "max-w-full",
          ].join(" ")}
          data-testid="agent-overlay"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: 0 }}
        >
          <CoachSchedulingAgentPanel
            mode="overlay"
            context={context}
            onClose={onDrawerClose}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
