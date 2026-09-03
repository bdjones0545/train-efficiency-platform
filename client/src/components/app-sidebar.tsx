import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Users,
  UsersRound,
  Calendar,
  CalendarClock,
  DollarSign,
  LogOut,
  UserCog,
  Trophy,
  Wallet,
  Settings,
  Paintbrush,
  CreditCard,
  Bot,
  CalendarDays,
  ImagePlay,
  Target,
  KanbanSquare,
  Brain,
  Home,
  TrendingUp,
  Building2,
  ChevronDown,
  Inbox,
  BarChart2,
  ClipboardList,
  Zap,
  CheckSquare,
  Bell,
  LayoutDashboard,
} from "lucide-react";
import { setLastOrgSlug } from "@/lib/logout";
import type { UserProfile } from "@shared/schema";
import { cn } from "@/lib/utils";
import { getOrgPreset } from "@/lib/org-presets";
import { isPlatformAdminOrg } from "@/lib/platform-access";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type NavItem = {
  title: string;
  url: string;
  icon: React.ElementType;
  testId: string;
};

type NavSection = {
  id: string;
  label: string;
  icon: React.ElementType;
  items: NavItem[];
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Storage helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// v3 key — section IDs changed; don't inherit stale v2 values
const OPEN_KEY = "sidebar_open_sections_v3";

function ls<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function itemIsActive(location: string, url: string): boolean {
  if (url === "/coach") return location === "/coach";
  return location === url || location.startsWith(url + "/");
}

function sectionIsActive(location: string, items: NavItem[]): boolean {
  return items.some((item) => itemIsActive(location, item.url));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NavLink — single item inside an accordion section
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function NavLink({
  item,
  location,
  onClick,
}: {
  item: NavItem;
  location: string;
  onClick: () => void;
}) {
  const active = itemIsActive(location, item.url);

  return (
    <Link
      href={item.url}
      onClick={onClick}
      data-testid={item.testId}
      className={cn(
        "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ml-1",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-foreground/70 hover:text-foreground hover:bg-muted/60"
      )}
    >
      <item.icon
        className={cn(
          "h-4 w-4 flex-shrink-0",
          active ? "text-primary" : "text-muted-foreground"
        )}
      />
      <span className="truncate">{item.title}</span>
      {active && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
      )}
    </Link>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DirectNavLink — top-level single-destination link (Home, Messages, Attention)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function DirectNavLink({
  item,
  location,
  onClick,
  badge,
}: {
  item: NavItem;
  location: string;
  onClick: () => void;
  badge?: number;
}) {
  const active = itemIsActive(location, item.url);

  return (
    <Link
      href={item.url}
      onClick={onClick}
      data-testid={item.testId}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-foreground/80 hover:text-foreground hover:bg-muted/60"
      )}
    >
      <item.icon
        className={cn(
          "h-4 w-4 flex-shrink-0",
          active ? "text-primary" : "text-muted-foreground"
        )}
      />
      <span className="flex-1 truncate">{item.title}</span>
      {badge !== undefined && badge > 0 ? (
        <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground leading-none">
          {badge}
        </span>
      ) : (
        active && (
          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
        )
      )}
    </Link>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AccordionSection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function AccordionSection({
  section,
  isOpen,
  onToggle,
  location,
  onNavClick,
  variant = "default",
  maxHeight = "700px",
}: {
  section: NavSection;
  isOpen: boolean;
  onToggle: (id: string) => void;
  location: string;
  onNavClick: () => void;
  variant?: "default" | "advanced";
  maxHeight?: string;
}) {
  const active = sectionIsActive(location, section.items);

  return (
    <div className="mb-0.5">
      <button
        onClick={() => onToggle(section.id)}
        data-testid={`section-${section.id}`}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors",
          variant === "advanced"
            ? "text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20"
            : "text-muted-foreground hover:bg-muted/60",
          active && variant !== "advanced" ? "text-foreground" : "",
          active && variant === "advanced"
            ? "text-orange-700 dark:text-orange-300"
            : ""
        )}
      >
        <span className="flex items-center gap-1.5">
          <section.icon className="h-3.5 w-3.5" />
          {section.label}
          {active && (
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                variant === "advanced" ? "bg-orange-500" : "bg-primary"
              )}
            />
          )}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200",
            isOpen ? "rotate-180" : ""
          )}
        />
      </button>

      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-in-out",
          isOpen ? "opacity-100" : "max-h-0 opacity-0"
        )}
        style={isOpen ? { maxHeight } : undefined}
      >
        <div className="mt-0.5 space-y-0.5 pb-1">
          {section.items.map((item) => (
            <NavLink
              key={item.url}
              item={item}
              location={location}
              onClick={onNavClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AttentionCountChip — compact badge at top of sidebar
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function AttentionCountChip({
  role,
  onNavClick,
}: {
  role: string;
  onNavClick: () => void;
}) {
  const isCoachOrAdmin = role === "COACH" || role === "ADMIN";

  const { data: count } = useQuery<{
    critical: number;
    important: number;
    total: number;
  }>({
    queryKey: ["/api/attention/count"],
    enabled: isCoachOrAdmin,
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const criticalCount = count?.critical ?? 0;
  const importantCount = count?.important ?? 0;
  const badgeCount = criticalCount + importantCount;

  if (badgeCount === 0) return null;

  return (
    <div className="mx-2 mb-2">
      <Link
        href="/admin/attention"
        onClick={onNavClick}
        data-testid="chip-attention-count"
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border",
          criticalCount > 0
            ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-900/40"
            : "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-900/40"
        )}
      >
        <Inbox className="h-3 w-3 flex-shrink-0" />
        <span className="flex-1 truncate">
          {badgeCount} item{badgeCount !== 1 ? "s" : ""} need
          {badgeCount === 1 ? "s" : ""} attention
        </span>
        <span
          className={cn(
            "flex-shrink-0 font-bold text-[10px] px-1.5 py-0.5 rounded-full",
            criticalCount > 0 ? "bg-red-500 text-white" : "bg-amber-500 text-white"
          )}
        >
          {badgeCount}
        </span>
      </Link>
    </div>
  );
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AppSidebar — main component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function AppSidebar() {
  const [location] = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();

  // Default: Schedule open, all advanced sections closed
  const [openSections, setOpenSections] = useState<Set<string>>(() =>
    new Set(ls<string[]>(OPEN_KEY, ["schedule"]))
  );

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: isAuthenticated,
  });

  const role = profile?.role || "CLIENT";
  const orgId = profile?.organizationId;
  const isAdmin = role === "ADMIN";
  const isCoach = role === "COACH";
  const isStaff = role === "STAFF";
  const isCoachOrAdmin = isCoach || isAdmin;

  const { data: organization, isLoading: orgLoading } = useQuery<{
    name: string;
    slug?: string;
    logoUrl?: string | null;
    coachTransactionsVisible?: boolean;
    athleticEnabled?: boolean;
    organizationType?: string | null;
  }>({
    queryKey: ["/api/organizations/by-id", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${orgId}`);
      if (!res.ok) throw new Error("Failed to fetch org");
      return res.json();
    },
    enabled: !!orgId,
  });

  const athleticEnabled = (organization as any)?.athleticEnabled === true;
  const coachTransactionsVisible =
    (organization as any)?.coachTransactionsVisible !== false;
  const orgSlug = (organization as any)?.slug || "";

  const preset = getOrgPreset(organization?.organizationType);

  const { data: athleticProgramsSidebar } = useQuery<any[]>({
    queryKey: ["/api/athletic/programs", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/athletic/programs?orgId=${orgId}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!orgId && athleticEnabled,
  });

  const activeAthleticPrograms =
    athleticProgramsSidebar?.filter(
      (p: any) => p.active && (p.type === "scheduling" || !p.type)
    ) || [];

  const activeProgramTools =
    athleticProgramsSidebar?.filter(
      (p: any) =>
        p.active &&
        (p.type === "pr_tracker" ||
          p.type === "workout_builder" ||
          p.type === "lead_capture" ||
          p.type === "attendance_tracker")
    ) || [];

  const programToolItems: NavItem[] = orgSlug
    ? activeProgramTools.map((p: any) => ({
        title: p.name,
        url:
          p.type === "lead_capture"
            ? `/lead-capture/programs/${p.id}`
            : p.type === "attendance_tracker"
            ? `/admin/attendance-tracker`
            : `/org/${orgSlug}/programs/${p.slug}`,
        icon:
          p.type === "pr_tracker"
            ? BarChart2
            : p.type === "lead_capture"
            ? Zap
            : p.type === "attendance_tracker"
            ? CheckSquare
            : ClipboardList,
        testId: `nav-program-tool-${p.id}`,
      }))
    : [];

  // Persist org slug for logout redirect
  useEffect(() => {
    if (orgSlug) setLastOrgSlug(orgSlug);
  }, [orgSlug]);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section definitions — outcome-based primary nav
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // ── SCHEDULE ─────────────────────────────────────────────────────────────────
  const scheduleSection: NavSection = {
    id: "schedule",
    label: "Schedule",
    icon: CalendarDays,
    items: [
      {
        title: "Dashboard",
        url: "/coach/dashboard",
        icon: LayoutDashboard,
        testId: "nav-scheduling-dashboard",
      },
      ...(isAdmin
        ? [
            {
              title: "Command Center",
              url: "/admin/scheduling-command-center",
              icon: CalendarDays,
              testId: "nav-scheduling-command-center",
            },
            {
              title: "Scheduling Copilot",
              url: "/admin/scheduling-copilot",
              icon: Bot,
              testId: "nav-scheduling-copilot",
            },
            {
              title: "Opportunity Inbox",
              url: "/admin/scheduling-opportunity-inbox",
              icon: Inbox,
              testId: "nav-scheduling-opportunity-inbox",
            },
            {
              title: "Coach Capacity",
              url: "/admin/coach-capacity",
              icon: BarChart2,
              testId: "nav-coach-capacity",
            },
          ]
        : []),
      {
        title: preset.nav.groupSessions,
        url: "/sessions",
        icon: UsersRound,
        testId: "nav-group-sessions",
      },
      {
        title: preset.nav.teamTraining,
        url: "/team-training",
        icon: Zap,
        testId: "nav-team-training",
      },
      {
        title: "Availability",
        url: "/coach/availability",
        icon: CalendarClock,
        testId: "nav-availability",
      },
      ...(athleticEnabled
        ? [
            {
              title:
                activeAthleticPrograms.length === 1
                  ? activeAthleticPrograms[0]?.name || "Athletic"
                  : "Athletic",
              url: "/coach/athletic",
              icon: Trophy,
              testId: "nav-athletic",
            },
          ]
        : []),
    ],
  };

  // ── ATHLETES ─────────────────────────────────────────────────────────────────
  const athletesSection: NavSection = {
    id: "athletes",
    label: "Athletes",
    icon: Users,
    items: [
      {
        title: "All Athletes",
        url: "/coach/users",
        icon: Users,
        testId: "nav-athletes",
      },
      ...(isAdmin
        ? [
            {
              title: "Athlete Intelligence",
              url: "/admin/athlete-intelligence",
              icon: Brain,
              testId: "nav-athlete-intelligence",
            },
            {
              title: "Athlete Onboarding",
              url: "/admin/athlete-onboarding",
              icon: ClipboardList,
              testId: "nav-athlete-onboarding",
            },
          ]
        : []),
      ...(isAdmin && isPlatformAdminOrg(organization?.name)
        ? [
            {
              title: "Customer Success",
              url: "/admin/customer-success-os",
              icon: Trophy,
              testId: "nav-customer-success",
            },
          ]
        : []),
      {
        title: "Redemptions",
        url: "/coach/redemptions",
        icon: CheckSquare,
        testId: "nav-redemptions",
      },
    ],
  };

  // ── LEADS — admin only ────────────────────────────────────────────────────────
  const leadsSection: NavSection = {
    id: "leads",
    label: "Leads",
    icon: Target,
    items: [
      {
        title: preset.nav.leads,
        url: "/admin/athlete-leads",
        icon: Users,
        testId: "nav-athlete-leads",
      },
      {
        title: preset.nav.businessLeads,
        url: "/admin/team-training-leads",
        icon: Building2,
        testId: "nav-business-leads",
      },
      {
        title: preset.nav.pipeline,
        url: "/admin/team-training-deals",
        icon: KanbanSquare,
        testId: "nav-pipeline",
      },
      {
        title: "Opportunities",
        url: "/admin/opportunity-acquisition",
        icon: Target,
        testId: "nav-opportunity-acquisition",
      },
    ],
  };

  // ── REVENUE ──────────────────────────────────────────────────────────────────
  const revenueSection: NavSection = {
    id: "revenue",
    label: "Revenue",
    icon: DollarSign,
    items: [
      ...(isAdmin
        ? [
            {
              title: "Overview",
              url: "/admin/financial-brain",
              icon: BarChart2,
              testId: "nav-revenue-overview",
            },
            {
              title: "Forecast",
              url: "/admin/forecast",
              icon: TrendingUp,
              testId: "nav-forecasting",
            },
          ]
        : []),
      ...(coachTransactionsVisible
        ? [
            {
              title: "Transactions",
              url: "/coach/transactions",
              icon: DollarSign,
              testId: "nav-revenue",
            },
          ]
        : []),
    ],
  };

  // ── SETTINGS ─────────────────────────────────────────────────────────────────
  const settingsSection: NavSection = {
    id: "settings",
    label: "Settings",
    icon: Settings,
    items: [
      {
        title: "My Profile",
        url: "/coach/profile",
        icon: UserCog,
        testId: "nav-my-profile",
      },
      ...(isAdmin
        ? [
            {
              title: "Coaches",
              url: "/coaches",
              icon: Users,
              testId: "nav-coaches",
            },
            {
              title: "Branding",
              url: "/admin/branding",
              icon: Paintbrush,
              testId: "nav-branding",
            },
            {
              title: "Stripe",
              url: "/admin/stripe",
              icon: CreditCard,
              testId: "nav-stripe",
            },
            {
              title: "Notifications",
              url: "/admin/notification-settings",
              icon: Bell,
              testId: "nav-notification-settings",
            },
            {
              title: "Configuration",
              url: "/admin/configuration",
              icon: Settings,
              testId: "nav-configuration",
            },
            {
              title: "Workforce Preferences",
              url: "/onboarding/ai-workforce",
              icon: Building2,
              testId: "nav-workforce-preferences",
            },
          ]
        : [
            {
              title: "Notifications",
              url: "/admin/notification-settings",
              icon: Bell,
              testId: "nav-notification-settings",
            },
          ]),
    ],
  };

  // ── STAFF — simplified scheduling-only view ───────────────────────────────────
  const staffSection: NavSection = {
    id: "operations",
    label: "Operations",
    icon: CalendarDays,
    items: [
      {
        title: "Coaches",
        url: "/coaches",
        icon: Users,
        testId: "nav-coaches",
      },
      {
        title: preset.nav.schedule,
        url: "/scheduling",
        icon: CalendarDays,
        testId: "nav-schedule",
      },
      {
        title: preset.nav.groupSessions,
        url: "/sessions",
        icon: UsersRound,
        testId: "nav-group-sessions",
      },
      {
        title: preset.nav.teamTraining,
        url: "/team-training",
        icon: Zap,
        testId: "nav-team-training",
      },
      {
        title: "My Bookings",
        url: "/bookings",
        icon: Calendar,
        testId: "nav-my-bookings",
      },
    ],
  };

  // ── CLIENT flat list ──────────────────────────────────────────────────────────
  const clientItems: NavItem[] = [
    { title: "Coaches", url: "/coaches", icon: Users, testId: "nav-coaches" },
    {
      title: preset.nav.groupSessions,
      url: "/sessions",
      icon: UsersRound,
      testId: "nav-group-sessions",
    },
    {
      title: preset.nav.teamTraining,
      url: "/team-training",
      icon: Zap,
      testId: "nav-team-training",
    },
    {
      title: "My Bookings",
      url: "/bookings",
      icon: Calendar,
      testId: "nav-my-bookings",
    },
    {
      title: "My Wallet",
      url: "/wallet",
      icon: Wallet,
      testId: "nav-my-wallet",
    },
    {
      title: "Scheduling Agent",
      url: "/scheduling/agent",
      icon: Bot,
      testId: "nav-scheduling-agent",
    },
    {
      title: "Settings",
      url: "/settings",
      icon: Settings,
      testId: "nav-settings",
    },
  ];

  // ── Top-level direct link items ───────────────────────────────────────────────

  const homeItem: NavItem = {
    title: "Home",
    url: "/",
    icon: Home,
    testId: "nav-home",
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Auto-expand parent section for the active route
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  useEffect(() => {
    const allSections = [
      scheduleSection,
      athletesSection,
      leadsSection,
      revenueSection,
      settingsSection,
    ];
    const active = allSections.find((s) => sectionIsActive(location, s.items));
    if (active && !openSections.has(active.id)) {
      setOpenSections((prev) => {
        const next = new Set(prev);
        next.add(active.id);
        lsSet(OPEN_KEY, [...next]);
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const toggleSection = useCallback(
    (id: string) => {
      setOpenSections((prev) => {
        let next: Set<string>;
        if (isMobile) {
          next = prev.has(id) ? new Set<string>() : new Set([id]);
        } else {
          next = new Set(prev);
          next.has(id) ? next.delete(id) : next.add(id);
        }
        lsSet(OPEN_KEY, [...next]);
        return next;
      });
    },
    [isMobile]
  );

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Render
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  return (
    <Sidebar>
      {/* ── Org header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border/50">
        {organization?.logoUrl ? (
          <img
            src={organization.logoUrl}
            alt={organization.name || "Logo"}
            className="h-7 rounded-md object-contain flex-shrink-0"
            data-testid="img-sidebar-logo"
          />
        ) : orgLoading ? (
          <div className="h-7 w-7 rounded-md bg-muted animate-pulse flex-shrink-0" />
        ) : (
          <img
            src="/train-logo.png"
            alt="TrainEfficiency"
            className="h-7 w-7 rounded-md object-contain flex-shrink-0 bg-black"
            data-testid="img-sidebar-logo"
          />
        )}
        <span className="font-semibold text-sm tracking-tight truncate">
          {organization?.name || (orgLoading ? "Loading..." : "My Organization")}
        </span>
      </div>

      <SidebarContent className="px-2 py-2 flex flex-col">

        {/* ── COACH / ADMIN view ──────────────────────────────────────────── */}
        {isCoachOrAdmin && (
          <>
            {/* Attention alert chip */}
            <AttentionCountChip role={role} onNavClick={handleNavClick} />

            <div className="space-y-0.5 flex-1">

              {/* HOME */}
              <div className="mb-1">
                <DirectNavLink
                  item={homeItem}
                  location={location}
                  onClick={handleNavClick}
                />
              </div>

              {/* SCHEDULE */}
              <AccordionSection
                section={scheduleSection}
                isOpen={openSections.has("schedule")}
                onToggle={toggleSection}
                location={location}
                onNavClick={handleNavClick}
              />

              {/* ATHLETES */}
              <AccordionSection
                section={athletesSection}
                isOpen={openSections.has("athletes")}
                onToggle={toggleSection}
                location={location}
                onNavClick={handleNavClick}
              />

              {/* LEADS — admin only */}
              {isAdmin && (
                <AccordionSection
                  section={leadsSection}
                  isOpen={openSections.has("leads")}
                  onToggle={toggleSection}
                  location={location}
                  onNavClick={handleNavClick}
                />
              )}

              {/* REVENUE */}
              {revenueSection.items.length > 0 && (
                <AccordionSection
                  section={revenueSection}
                  isOpen={openSections.has("revenue")}
                  onToggle={toggleSection}
                  location={location}
                  onNavClick={handleNavClick}
                />
              )}

              {/* PROGRAM TOOLS — dynamic (if org has active tools) */}
              {programToolItems.length > 0 && (
                <AccordionSection
                  section={{
                    id: "program-tools",
                    label: "Program Tools",
                    icon: ClipboardList,
                    items: programToolItems,
                  }}
                  isOpen={openSections.has("program-tools")}
                  onToggle={toggleSection}
                  location={location}
                  onNavClick={handleNavClick}
                />
              )}

              {/* SETTINGS */}
              <AccordionSection
                section={settingsSection}
                isOpen={openSections.has("settings")}
                onToggle={toggleSection}
                location={location}
                onNavClick={handleNavClick}
              />

            </div>

          </>
        )}

        {/* ── STAFF view ──────────────────────────────────────────────────── */}
        {isStaff && (
          <div className="space-y-0.5">
            <AccordionSection
              section={staffSection}
              isOpen={openSections.has("operations")}
              onToggle={toggleSection}
              location={location}
              onNavClick={handleNavClick}
            />
          </div>
        )}

        {/* ── CLIENT view ─────────────────────────────────────────────────── */}
        {role === "CLIENT" && (
          <div className="space-y-0.5">
            <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Browse
            </p>
            {clientItems.map((item) => {
              const active = itemIsActive(location, item.url);
              return (
                <Link
                  key={item.url}
                  href={item.url}
                  onClick={handleNavClick}
                  data-testid={item.testId}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-foreground/70 hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  <item.icon
                    className={cn(
                      "h-4 w-4 flex-shrink-0",
                      active ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                  <span>{item.title}</span>
                  {active && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </SidebarContent>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <SidebarFooter className="p-3 border-t border-border/50">
        {user && (
          <div className="flex items-center gap-2">
            <Avatar className="h-7 w-7 flex-shrink-0">
              <AvatarImage src={user.profileImageUrl || undefined} />
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {(user.firstName?.[0] || "U").toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {user.email}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 flex-shrink-0"
              data-testid="button-logout"
              onClick={() => logout(orgSlug ? `/org/${orgSlug}` : undefined)}
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
