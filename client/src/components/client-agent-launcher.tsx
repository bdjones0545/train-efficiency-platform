import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CalendarCheck } from "lucide-react";
import { CoachSchedulingAgentPanel, type AgentContext, type SourcePage } from "@/components/coach-agent-panel";

interface Booking {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
}

function getClientSourcePage(path: string): SourcePage {
  if (path.startsWith("/bookings") || path.startsWith("/sessions")) return "schedule";
  if (path.startsWith("/coaches")) return "dashboard";
  if (path.startsWith("/portal") || path.startsWith("/wallet")) return "settings";
  return "dashboard";
}

function getClientBadge(bookings: Booking[] | undefined): { label: string; urgent: boolean } | null {
  if (!bookings || bookings.length === 0) return null;
  const now = new Date();
  const todayStr = now.toDateString();
  const upcoming = bookings.filter(b => b.status !== "CANCELLED" && new Date(b.startAt) >= now);
  const todayCount = upcoming.filter(b => new Date(b.startAt).toDateString() === todayStr).length;
  if (todayCount > 0) return { label: String(todayCount), urgent: true };
  if (upcoming.length > 0) return { label: "•", urgent: false };
  return null;
}

export function ClientAgentLauncher() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  const { data: profile } = useQuery<{ role?: string }>({ queryKey: ["/api/profile"] });
  const userRole = profile?.role || "CLIENT";
  const isStaff = userRole === "COACH" || userRole === "ADMIN" || userRole === "STAFF";

  const { data: bookings } = useQuery<Booking[]>({
    queryKey: ["/api/bookings"],
    enabled: !isStaff && !!profile,
    staleTime: 2 * 60 * 1000,
  });

  const badge = getClientBadge(bookings);
  const isOnAgentPage = location === "/scheduling/agent";

  if (isStaff || isOnAgentPage || !profile) return null;

  const sourcePage = getClientSourcePage(location);
  const context: AgentContext = {
    sourcePage,
    sourcePath: location,
    openedAt: Date.now(),
  };

  return (
    <>
      {/* Floating launcher button */}
      <button
        data-testid="client-agent-launcher"
        aria-label="Open scheduling assistant"
        onClick={() => setOpen(true)}
        className={[
          "fixed z-50 flex items-center justify-center rounded-full shadow-lg",
          "bg-primary text-primary-foreground",
          "transition-transform hover:scale-105 active:scale-95",
        ].join(" ")}
        style={{
          width: 52,
          height: 52,
          bottom: `max(5rem, calc(env(safe-area-inset-bottom) + 4.5rem))`,
          right: "1.25rem",
        }}
      >
        <CalendarCheck className="h-5 w-5" />
        {badge && (
          <span
            data-testid="client-agent-badge"
            className={[
              "absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full px-1",
              "flex items-center justify-center",
              "text-[10px] font-bold leading-none",
              badge.urgent ? "bg-red-500 text-white" : "bg-blue-500 text-white",
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
          data-testid="client-agent-overlay"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: 0 }}
        >
          <CoachSchedulingAgentPanel
            mode="overlay"
            context={context}
            onClose={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
