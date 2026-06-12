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
  Dumbbell,
  Settings,
  Paintbrush,
  CreditCard,
  Bot,
  CalendarDays,
  ImagePlay,
  Target,
  KanbanSquare,
  Brain,
  GitBranch,
  Shield,
  ShieldAlert,
  Home,
  TrendingUp,
  Building2,
  ChevronDown,
  Inbox,
  BarChart2,
  ClipboardList,
  Layers,
  Zap,
  Wrench,
  Globe,
  CheckSquare,
  Bell,
  MessageSquare,
  BookOpen,
  Mail,
  Plug,
  Briefcase,
  Factory,
  BadgeDollarSign,
  Handshake,
  LayoutDashboard,
} from "lucide-react";
import { setLastOrgSlug } from "@/lib/logout";
import type { UserProfile } from "@shared/schema";
import { cn } from "@/lib/utils";
import { getOrgPreset } from "@/lib/org-presets";

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

// v2 key — does not conflict with the old simplified/advanced localStorage keys
const OPEN_KEY = "sidebar_open_sections_v2";

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
// DirectNavLink — top-level single-destination link (Home, Approvals)
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
}: {
  section: NavSection;
  isOpen: boolean;
  onToggle: (id: string) => void;
  location: string;
  onNavClick: () => void;
  variant?: "default" | "engineering";
}) {
  const active = sectionIsActive(location, section.items);

  return (
    <div className="mb-0.5">
      <button
        onClick={() => onToggle(section.id)}
        data-testid={`section-${section.id}`}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors",
          variant === "engineering"
            ? "text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20"
            : "text-muted-foreground hover:bg-muted/60",
          active && variant !== "engineering" ? "text-foreground" : "",
          active && variant === "engineering"
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
                variant === "engineering" ? "bg-orange-500" : "bg-primary"
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
          isOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
        )}
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

  const { data: items = [] } = useQuery<any[]>({
    queryKey: ["/api/attention"],
    enabled: isCoachOrAdmin,
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const active = items.filter(
    (i: any) => i.status === "active" || i.status === "escalated"
  );
  const criticalCount = active.filter(
    (i: any) => i.level === "critical" || i.status === "escalated"
  ).length;
  const importantCount = active.filter(
    (i: any) => i.level === "important"
  ).length;
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
// WorkforceCta — org-state-aware entry point for AI Workforce
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface SetupStatus {
  isConfigured: boolean;
  hasWorkforceRecord: boolean;
  hasDepartments: boolean;
  hasGovernanceSettings: boolean;
  hasAutomationSettings: boolean;
  setupCompleteFlag: boolean;
}

function WorkforceCta({ onNavClick }: { onNavClick: () => void }) {
  const { data: status, isLoading } = useQuery<SetupStatus>({
    queryKey: ["/api/ai-workforce/setup-status"],
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) return null;

  const isConfigured = status?.isConfigured ?? false;

  if (isConfigured) {
    return (
      <Link href="/admin/ai-governance" onClick={onNavClick}>
        <div
          className="mx-2 mb-2 flex items-center gap-2.5 px-3 py-2.5 rounded-md border border-violet-200/60 dark:border-violet-800/40 bg-gradient-to-r from-violet-50/80 to-purple-50/80 dark:from-violet-900/20 dark:to-purple-900/20 hover:from-violet-100 hover:to-purple-100 dark:hover:from-violet-900/30 dark:hover:to-purple-900/30 transition-colors cursor-pointer"
          data-testid="cta-workforce-dashboard"
        >
          <div className="h-6 w-6 rounded bg-violet-100 dark:bg-violet-800/50 flex items-center justify-center flex-shrink-0">
            <Zap className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-violet-900 dark:text-violet-200 leading-tight">
              AI Governance
            </p>
            <p className="text-[10px] text-violet-500 dark:text-violet-400 leading-tight mt-0.5">
              Agents, rules & automation
            </p>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link href="/onboarding/ai-workforce" onClick={onNavClick}>
      <div
        className="mx-2 mb-2 flex items-center gap-2.5 px-3 py-2.5 rounded-md border border-violet-200/60 dark:border-violet-800/40 bg-gradient-to-r from-violet-50/80 to-purple-50/80 dark:from-violet-900/20 dark:to-purple-900/20 hover:from-violet-100 hover:to-purple-100 dark:hover:from-violet-900/30 dark:hover:to-purple-900/30 transition-colors cursor-pointer"
        data-testid="cta-workforce-setup-wizard"
      >
        <div className="h-6 w-6 rounded bg-violet-100 dark:bg-violet-800/50 flex items-center justify-center flex-shrink-0">
          <Zap className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-violet-900 dark:text-violet-200 leading-tight">
            AI Workforce Setup
          </p>
          <p className="text-[10px] text-violet-500 dark:text-violet-400 leading-tight mt-0.5">
            Configure agents & automation rules
          </p>
        </div>
      </div>
    </Link>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AppSidebar — main component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function AppSidebar() {
  const [location] = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();

  // Default: Operations + Growth open, Engineering closed
  const [openSections, setOpenSections] = useState<Set<string>>(() =>
    new Set(ls<string[]>(OPEN_KEY, ["operations", "growth"]))
  );

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: isAuthenticated,
  });

  // Attention count for Approvals badge
  const { data: attentionItems = [] } = useQuery<any[]>({
    queryKey: ["/api/attention"],
    enabled: isAuthenticated,
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
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

  // Attention badge count for Approvals link
  const activeAttention = attentionItems.filter(
    (i: any) => i.status === "active" || i.status === "escalated"
  );
  const approvalsCount = activeAttention.filter(
    (i: any) =>
      i.level === "critical" ||
      i.status === "escalated" ||
      i.level === "important"
  ).length;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Section definitions
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // OPERATIONS
  const operationsSection: NavSection = {
    id: "operations",
    label: "Operations",
    icon: CalendarDays,
    items: [
      {
        title: "Scheduling Dashboard",
        url: "/coach/dashboard",
        icon: LayoutDashboard,
        testId: "nav-scheduling-dashboard",
      },
      ...(isAdmin
        ? [
            {
              title: "Scheduling Command Center",
              url: "/admin/scheduling-command-center",
              icon: CalendarDays,
              testId: "nav-scheduling-command-center",
            },
          ]
        : []),
      {
        title: preset.nav.athletes,
        url: "/coach/users",
        icon: Users,
        testId: "nav-athletes",
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
        title: "Availability",
        url: "/coach/availability",
        icon: CalendarClock,
        testId: "nav-availability",
      },
      // Outreach (AgentMail renamed) — admin only
      ...(isAdmin
        ? [
            {
              title: "Outreach",
              url: "/admin/agentmail",
              icon: MessageSquare,
              testId: "nav-outreach",
            },
          ]
        : []),
      // Athletic program link if enabled
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

  // GROWTH — admin sees Leads + Pipeline + Revenue; coach sees Revenue only
  const growthSection: NavSection = {
    id: "growth",
    label: "Growth",
    icon: TrendingUp,
    items: [
      ...(isAdmin
        ? [
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
              title: "Opportunity Acquisition",
              url: "/admin/opportunity-acquisition",
              icon: Target,
              testId: "nav-opportunity-acquisition",
            },
            {
              title: "Hiring Department",
              url: "/admin/hiring",
              icon: Briefcase,
              testId: "nav-hiring-department",
            },
            {
              title: "Partnerships Department",
              url: "/admin/partnerships",
              icon: Handshake,
              testId: "nav-partnerships-department",
            },
            {
              title: "Departments",
              url: "/admin/departments",
              icon: Building2,
              testId: "nav-departments",
            },
            {
              title: "Sponsorship Department",
              url: "/admin/sponsorships",
              icon: BadgeDollarSign,
              testId: "nav-sponsorships-department",
            },
            {
              title: "Department Factory",
              url: "/admin/department-factory",
              icon: Factory,
              testId: "nav-department-factory",
            },
            {
              title: "Department OS v2",
              url: "/admin/department-os-v2",
              icon: Layers,
              testId: "nav-department-os-v2",
            },
          ]
        : []),
      ...(coachTransactionsVisible
        ? [
            {
              title: preset.nav.revenue,
              url: "/coach/transactions",
              icon: DollarSign,
              testId: "nav-revenue",
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

  // INSIGHTS — admin only
  // TODO Phase 5: consolidate into /intelligence tabbed hub
  const insightsSection: NavSection = {
    id: "insights",
    label: "Insights",
    icon: BookOpen,
    items: [
      {
        title: "Learning",
        url: "/admin/obsidian",
        icon: BookOpen,
        testId: "nav-learning",
      },
      {
        title: "Forecasting",
        url: "/admin/forecast",
        icon: TrendingUp,
        testId: "nav-forecasting",
      },
      {
        title: "Business Overview",
        url: "/admin/ceo-heartbeat",
        icon: Brain,
        testId: "nav-business-overview",
      },
    ],
  };

  // SETTINGS — profile + org settings
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
              title: "Setup Wizard",
              url: "/setup",
              icon: Building2,
              testId: "nav-setup-wizard",
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

  // ENGINEERING — admin only, collapsed by default
  // Contains: all advanced/developer/internal tools hidden from standard nav
  const engineeringSection: NavSection = {
    id: "engineering",
    label: "Engineering",
    icon: Wrench,
    items: [
      {
        title: "System Health",
        url: "/admin/agent-ops",
        icon: ShieldAlert,
        testId: "nav-system-health",
      },
      {
        title: "Automations",
        url: "/admin/workflow-orchestrator",
        icon: GitBranch,
        testId: "nav-automations",
      },
      {
        title: "AI Permissions",
        url: "/admin/autonomy-trust",
        icon: Shield,
        testId: "nav-ai-permissions",
      },
      {
        title: "Email Logs",
        url: "/admin/email-audit",
        icon: Mail,
        testId: "nav-email-logs",
      },
      {
        title: "Automation Settings",
        url: "/admin/autonomy-controls",
        icon: Settings,
        testId: "nav-automation-settings",
      },
      {
        title: "Workflow Builder",
        url: "/admin/workflow-builder",
        icon: Zap,
        testId: "nav-workflow-builder",
      },
      {
        title: "Agent Tools",
        url: "/admin/agent-tools",
        icon: Plug,
        testId: "nav-agent-tools",
      },
      {
        title: "Integration Status",
        url: "/admin/ecosystem-health",
        icon: Globe,
        testId: "nav-integration-status",
      },
      {
        title: "Workforce Health",
        url: "/admin/ai-workforce",
        icon: Users,
        testId: "nav-workforce-health",
      },
      {
        title: "Gmail Conversations",
        url: "/admin/gmail-conversations",
        icon: Mail,
        testId: "nav-gmail-conversations",
      },
      {
        title: "Trigger Audit",
        url: "/admin/trigger-audit",
        icon: Shield,
        testId: "nav-trigger-audit",
      },
      {
        title: "AI Governance",
        url: "/admin/ai-governance",
        icon: Shield,
        testId: "nav-ai-governance",
      },
    ],
  };

  // STAFF — simplified scheduling-only view
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

  // CLIENT flat list
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

  // HOME direct link item
  // TODO Phase 2: /command-center, /coach, /admin/dashboard are migration targets
  // for the unified Home Screen. Do not remove routes yet.
  const homeItem: NavItem = {
    title: "Home",
    url: "/",
    icon: Home,
    testId: "nav-home",
  };

  // APPROVALS direct link item
  const approvalsItem: NavItem = {
    title: "Approvals",
    url: "/admin/attention",
    icon: CheckSquare,
    testId: "nav-approvals",
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Auto-expand parent section for the active route
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  useEffect(() => {
    const allSections = [
      operationsSection,
      growthSection,
      insightsSection,
      settingsSection,
      engineeringSection,
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
          <div
            className="h-7 w-7 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold text-xs flex-shrink-0"
            data-testid="img-sidebar-logo"
          >
            {(organization?.name || "").charAt(0).toUpperCase()}
          </div>
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
              {/* HOME — single direct link */}
              <div className="mb-1">
                <DirectNavLink
                  item={homeItem}
                  location={location}
                  onClick={handleNavClick}
                />
              </div>

              {/* OPERATIONS */}
              <AccordionSection
                section={operationsSection}
                isOpen={openSections.has("operations")}
                onToggle={toggleSection}
                location={location}
                onNavClick={handleNavClick}
              />

              {/* GROWTH */}
              {growthSection.items.length > 0 && (
                <AccordionSection
                  section={growthSection}
                  isOpen={openSections.has("growth")}
                  onToggle={toggleSection}
                  location={location}
                  onNavClick={handleNavClick}
                />
              )}

              {/* APPROVALS — single direct link with badge */}
              <div className="mb-0.5">
                <DirectNavLink
                  item={approvalsItem}
                  location={location}
                  onClick={handleNavClick}
                  badge={approvalsCount > 0 ? approvalsCount : undefined}
                />
              </div>

              {/* INSIGHTS — admin only */}
              {isAdmin && (
                <AccordionSection
                  section={insightsSection}
                  isOpen={openSections.has("insights")}
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

              {/* ENGINEERING — admin only, collapsed by default */}
              {isAdmin && (
                <>
                  <div className="my-2 border-t border-border/40" />
                  <AccordionSection
                    section={engineeringSection}
                    isOpen={openSections.has("engineering")}
                    onToggle={toggleSection}
                    location={location}
                    onNavClick={handleNavClick}
                    variant="engineering"
                  />
                </>
              )}
            </div>

            {/* AI Workforce CTA — admin only */}
            {isAdmin && <WorkforceCta onNavClick={handleNavClick} />}
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
