import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Home,
  Calendar,
  BarChart2,
  ClipboardList,
  BookOpen,
  UsersRound,
  Bell,
  UserCog,
  Shield,
  LogOut,
  ChevronDown,
  Loader2,
  Lock,
  GraduationCap,
  PenSquare,
  Activity,
  Zap,
  Layers,
  Film,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getAuthHeaders } from "@/lib/authToken";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface NavContextResponse {
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgLogoUrl: string | null;
  primaryColor: string | null;
  tools: Array<{ id: string; name: string; slug: string; type: string }>;
  effectiveRole: string | null;
  userName: string | null;
  userEmail: string | null;
  userId: string | null;
  isAuthenticated: boolean;
}

interface OrgSidebarProps {
  orgSlug: string;
}

interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  testId: string;
}

interface NavSection {
  id: string;
  label: string;
  icon: React.ElementType;
  items: NavItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function itemIsActive(location: string, url: string): boolean {
  return location === url || location.startsWith(url + "/");
}

function sectionIsActive(location: string, items: NavItem[]): boolean {
  return items.some((item) => itemIsActive(location, item.url));
}

// ─────────────────────────────────────────────────────────────────────────────
// NavLink
// ─────────────────────────────────────────────────────────────────────────────

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
      <span className="truncate">{item.title}</span>
      {active && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
      )}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AccordionSection
// ─────────────────────────────────────────────────────────────────────────────

function AccordionSection({
  section,
  isOpen,
  onToggle,
  location,
  onNavClick,
}: {
  section: NavSection;
  isOpen: boolean;
  onToggle: (id: string) => void;
  location: string;
  onNavClick: () => void;
}) {
  const active = sectionIsActive(location, section.items);

  return (
    <div className="mb-0.5">
      <button
        onClick={() => onToggle(section.id)}
        data-testid={`org-section-${section.id}`}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors text-muted-foreground hover:bg-muted/60",
          active ? "text-foreground" : ""
        )}
      >
        <span className="flex items-center gap-1.5">
          <section.icon className="h-3.5 w-3.5" />
          {section.label}
          {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
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
          isOpen ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
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

// ─────────────────────────────────────────────────────────────────────────────
// Tool icon mapper
// ─────────────────────────────────────────────────────────────────────────────

function toolIcon(type: string): React.ElementType {
  if (type === "pr_tracker") return BarChart2;
  if (type === "workout_builder") return ClipboardList;
  return ClipboardList;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build nav sections by role
// ─────────────────────────────────────────────────────────────────────────────

function buildNavSections(
  orgSlug: string,
  effectiveRole: string | null,
  tools: NavContextResponse["tools"]
): NavSection[] {
  const prTool = tools.find((t) => t.type === "pr_tracker");
  const wbTool = tools.find((t) => t.type === "workout_builder");

  const toolItems: NavItem[] = tools.map((t) => ({
    title: t.name,
    url: `/org/${orgSlug}/programs/${t.slug}`,
    icon: toolIcon(t.type),
    testId: `org-nav-tool-${t.slug}`,
  }));

  const isFullCoach = ["coach", "admin", "owner"].includes(effectiveRole ?? "");
  const isTeamCoach = effectiveRole === "team_coach";
  const isAthlete = effectiveRole === "athlete";
  const isGuardian = effectiveRole === "guardian";

  if (isFullCoach) {
    const sections: NavSection[] = [
      {
        id: "org-home",
        label: "Portal",
        icon: Home,
        items: [
          { title: "Home", url: `/org/${orgSlug}/portal`, icon: Home, testId: "org-nav-portal" },
          { title: "Calendar", url: `/org/${orgSlug}/calendar`, icon: Calendar, testId: "org-nav-calendar" },
        ],
      },
    ];

    if (toolItems.length > 0) {
      const wbItems = [...toolItems];
      if (wbTool) {
        wbItems.push({
          title: "Program Builder",
          url: `/org/${orgSlug}/programs/${wbTool.slug}/builder`,
          icon: Layers,
          testId: "org-nav-program-builder",
        });
        wbItems.push({
          title: "Exercise Media",
          url: `/org/${orgSlug}/coach/exercise-media`,
          icon: Film,
          testId: "org-nav-exercise-media",
        });
      }
      sections.push({
        id: "org-tools",
        label: "Program Tools",
        icon: ClipboardList,
        items: wbItems,
      });
    }

    sections.push({
      id: "org-education",
      label: "Education",
      icon: GraduationCap,
      items: [
        { title: "Education Builder", url: `/org/${orgSlug}/coach/education-builder`, icon: PenSquare, testId: "org-nav-education-builder" },
        { title: "Education Progress", url: `/org/${orgSlug}/coach/education-progress`, icon: BarChart2, testId: "org-nav-education-progress" },
      ],
    });

    sections.push({
      id: "org-intelligence",
      label: "Athlete Intelligence",
      icon: Activity,
      items: [
        { title: "Athlete Status", url: `/org/${orgSlug}/coach/athlete-status`, icon: Activity, testId: "org-nav-athlete-status" },
        { title: "Workflows", url: `/org/${orgSlug}/coach/workflows`, icon: Zap, testId: "org-nav-workflows" },
      ],
    });

    sections.push({
      id: "org-manage",
      label: "Manage",
      icon: UsersRound,
      items: [
        { title: "Teams", url: `/org/${orgSlug}/coach/teams`, icon: UsersRound, testId: "org-nav-teams" },
      ],
    });

    sections.push({
      id: "org-account",
      label: "Account",
      icon: UserCog,
      items: [
        { title: "Notifications", url: `/org/${orgSlug}/notifications`, icon: Bell, testId: "org-nav-notifications" },
        { title: "My Profile", url: `/org/${orgSlug}/profile`, icon: UserCog, testId: "org-nav-profile" },
      ],
    });

    return sections;
  }

  if (isTeamCoach) {
    const sections: NavSection[] = [
      {
        id: "org-home",
        label: "Portal",
        icon: Home,
        items: [
          { title: "Home", url: `/org/${orgSlug}/portal`, icon: Home, testId: "org-nav-portal" },
        ],
      },
    ];

    if (toolItems.length > 0) {
      sections.push({
        id: "org-tools",
        label: "Program Tools",
        icon: ClipboardList,
        items: toolItems,
      });
    }

    sections.push({
      id: "org-education",
      label: "Education",
      icon: GraduationCap,
      items: [
        { title: "Education Progress", url: `/org/${orgSlug}/coach/education-progress`, icon: BarChart2, testId: "org-nav-education-progress" },
      ],
    });

    sections.push({
      id: "org-account",
      label: "Account",
      icon: UserCog,
      items: [
        { title: "Notifications", url: `/org/${orgSlug}/notifications`, icon: Bell, testId: "org-nav-notifications" },
        { title: "My Profile", url: `/org/${orgSlug}/profile`, icon: UserCog, testId: "org-nav-profile" },
      ],
    });

    return sections;
  }

  if (isAthlete) {
    const sections: NavSection[] = [
      {
        id: "org-home",
        label: "My Hub",
        icon: Home,
        items: [
          { title: "Portal", url: `/org/${orgSlug}/portal`, icon: Home, testId: "org-nav-portal" },
          { title: "My Schedule", url: `/org/${orgSlug}/my-schedule`, icon: Calendar, testId: "org-nav-schedule" },
        ],
      },
    ];

    if (toolItems.length > 0) {
      sections.push({
        id: "org-tools",
        label: "Training",
        icon: ClipboardList,
        items: [
          ...(prTool ? [{ title: prTool.name, url: `/org/${orgSlug}/programs/${prTool.slug}`, icon: BarChart2, testId: `org-nav-tool-${prTool.slug}` }] : []),
          ...(wbTool ? [{ title: "My Workouts", url: `/org/${orgSlug}/programs/${wbTool.slug}`, icon: ClipboardList, testId: `org-nav-tool-${wbTool.slug}` }] : []),
        ],
      });
    }

    sections.push({
      id: "org-education",
      label: "Education",
      icon: GraduationCap,
      items: [
        { title: "My Learning", url: `/org/${orgSlug}/education`, icon: BookOpen, testId: "org-nav-education" },
      ],
    });

    sections.push({
      id: "org-account",
      label: "Account",
      icon: UserCog,
      items: [
        { title: "Notifications", url: `/org/${orgSlug}/notifications`, icon: Bell, testId: "org-nav-notifications" },
        { title: "My Profile", url: `/org/${orgSlug}/profile`, icon: UserCog, testId: "org-nav-profile" },
      ],
    });

    return sections;
  }

  if (isGuardian) {
    const sections: NavSection[] = [
      {
        id: "org-home",
        label: "Guardian",
        icon: Shield,
        items: [
          { title: "Guardian Portal", url: `/org/${orgSlug}/guardian`, icon: Shield, testId: "org-nav-guardian" },
          { title: "Schedule", url: `/org/${orgSlug}/my-schedule`, icon: Calendar, testId: "org-nav-schedule" },
        ],
      },
    ];

    const athleteItems: NavItem[] = [
      ...(wbTool ? [{ title: "Workouts", url: `/org/${orgSlug}/programs/${wbTool.slug}`, icon: ClipboardList, testId: `org-nav-tool-${wbTool.slug}` }] : []),
    ];

    if (athleteItems.length > 0) {
      sections.push({
        id: "org-tools",
        label: "Athlete",
        icon: ClipboardList,
        items: athleteItems,
      });
    }

    sections.push({
      id: "org-education",
      label: "Education",
      icon: GraduationCap,
      items: [
        { title: "Athlete Education", url: `/org/${orgSlug}/education`, icon: BookOpen, testId: "org-nav-education" },
      ],
    });

    sections.push({
      id: "org-account",
      label: "Account",
      icon: UserCog,
      items: [
        { title: "Notifications", url: `/org/${orgSlug}/notifications`, icon: Bell, testId: "org-nav-notifications" },
        { title: "My Profile", url: `/org/${orgSlug}/profile`, icon: UserCog, testId: "org-nav-profile" },
      ],
    });

    return sections;
  }

  // Unauthenticated — show public-facing items only
  return [
    {
      id: "org-public",
      label: "Explore",
      icon: Home,
      items: [
        { title: "Home", url: `/org/${orgSlug}`, icon: Home, testId: "org-nav-landing" },
        { title: "Portal", url: `/org/${orgSlug}/portal`, icon: Home, testId: "org-nav-portal" },
      ],
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// OrgSidebar – main export
// ─────────────────────────────────────────────────────────────────────────────

export function OrgSidebar({ orgSlug }: OrgSidebarProps) {
  const [location] = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();

  // Track org token — we don't know orgId until after the first fetch
  const [orgToken, setOrgToken] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["org-home", "org-tools"]));

  // Phase 1: public fetch (no auth) — establishes orgId
  const { data: pubCtx, isLoading: pubLoading } = useQuery<NavContextResponse>({
    queryKey: [`/api/org/by-slug/${orgSlug}/nav-context`],
    queryFn: () =>
      fetch(`/api/org/by-slug/${orgSlug}/nav-context`, {
        headers: getAuthHeaders(),
        credentials: "include",
      }).then((r) => r.json()),
    staleTime: 30_000,
  });

  // Once we know orgId, check localStorage for an org auth token
  useEffect(() => {
    if (pubCtx?.orgId && !orgToken) {
      const stored = localStorage.getItem(`orgToken_${pubCtx.orgId}`);
      if (stored) setOrgToken(stored);
    }
  }, [pubCtx?.orgId, orgToken]);

  // Phase 2: authenticated fetch (fires once orgToken is known)
  const { data: authCtx } = useQuery<NavContextResponse>({
    queryKey: [`/api/org/by-slug/${orgSlug}/nav-context`, orgToken],
    queryFn: () =>
      fetch(`/api/org/by-slug/${orgSlug}/nav-context`, {
        headers: {
          ...getAuthHeaders(),
          ...(orgToken ? { "X-Org-Auth-Token": orgToken } : {}),
        },
        credentials: "include",
      }).then((r) => r.json()),
    enabled: !!orgToken,
    staleTime: 30_000,
  });

  // Use the most-enriched context available
  const ctx: NavContextResponse | undefined = authCtx ?? pubCtx;

  // Auto-expand section for active route
  useEffect(() => {
    if (!ctx) return;
    const sections = buildNavSections(orgSlug, ctx.effectiveRole, ctx.tools ?? []);
    const activeSection = sections.find((s) => sectionIsActive(location, s.items));
    if (activeSection) {
      setOpenSections((prev) => {
        if (prev.has(activeSection.id)) return prev;
        return new Set([...prev, activeSection.id]);
      });
    }
  }, [location, ctx, orgSlug]);

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  const handleLogout = () => {
    if (ctx?.orgId) {
      localStorage.removeItem(`orgToken_${ctx.orgId}`);
    }
    setOrgToken(null);
    window.location.href = `/org/${orgSlug}`;
  };

  const sections = ctx
    ? buildNavSections(orgSlug, ctx.effectiveRole, ctx.tools ?? [])
    : [];

  const isLoading = pubLoading && !ctx;

  return (
    <Sidebar>
      {/* ── Org header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border/50">
        {ctx?.orgLogoUrl ? (
          <img
            src={ctx.orgLogoUrl}
            alt={ctx.orgName || "Logo"}
            className="h-7 rounded-md object-contain flex-shrink-0"
            data-testid="img-org-sidebar-logo"
          />
        ) : isLoading ? (
          <div className="h-7 w-7 rounded-md bg-muted animate-pulse flex-shrink-0" />
        ) : (
          <div
            className="h-7 w-7 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold text-xs flex-shrink-0"
            data-testid="img-org-sidebar-logo"
          >
            {(ctx?.orgName || orgSlug).charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm tracking-tight truncate" data-testid="text-org-sidebar-name">
            {isLoading ? "Loading…" : ctx?.orgName || orgSlug}
          </p>
          {ctx?.isAuthenticated && ctx.effectiveRole && (
            <p className="text-[10px] text-muted-foreground capitalize truncate">
              {ctx.effectiveRole.replace("_", " ")}
            </p>
          )}
        </div>
      </div>

      <SidebarContent className="px-2 py-2 flex flex-col">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && !ctx?.isAuthenticated && (
          <div className="mx-1 mb-3 p-2.5 rounded-md border border-border/60 bg-muted/30 text-center">
            <Lock className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
            <p className="text-xs text-muted-foreground leading-tight">
              Log in to access your training tools.
            </p>
          </div>
        )}

        {!isLoading && sections.length > 0 && (
          <div className="space-y-0.5 flex-1">
            {sections.map((section) => (
              <AccordionSection
                key={section.id}
                section={section}
                isOpen={openSections.has(section.id)}
                onToggle={toggleSection}
                location={location}
                onNavClick={handleNavClick}
              />
            ))}
          </div>
        )}
      </SidebarContent>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <SidebarFooter className="p-3 border-t border-border/50">
        {ctx?.isAuthenticated && ctx.userName ? (
          <div className="flex items-center gap-2">
            <Avatar className="h-7 w-7 flex-shrink-0">
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {(ctx.userName[0] || "U").toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" data-testid="text-org-sidebar-user">
                {ctx.userName}
              </p>
              {ctx.userEmail && (
                <p className="text-xs text-muted-foreground truncate">{ctx.userEmail}</p>
              )}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 flex-shrink-0"
              data-testid="button-org-logout"
              onClick={handleLogout}
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : !isLoading ? (
          <Link
            href={`/org/${orgSlug}`}
            data-testid="link-org-go-home"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Home className="h-3.5 w-3.5" />
            <span>Back to {ctx?.orgName || "home"}</span>
          </Link>
        ) : null}
      </SidebarFooter>
    </Sidebar>
  );
}
