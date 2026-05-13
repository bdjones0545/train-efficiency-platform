import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  LayoutDashboard,
  DollarSign,
  LogOut,
  UserCog,
  Trophy,
  Wallet,
  Briefcase,
  FileText,
  Dumbbell,
  Settings,
  Paintbrush,
  CreditCard,
  Sparkles,
  Trash2,
  Bot,
  CalendarDays,
  ImagePlay,
  Target,
  Flame,
  KanbanSquare,
  Activity,
  Brain,
  Plug,
  GitBranch,
  ShieldAlert,
  Home,
  TrendingUp,
  Cpu,
  Building2,
  ChevronDown,
  Radio,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { clearAuthToken } from "@/lib/authToken";
import logoImg from "@assets/IMG_7961_1771105509253.jpeg";
import type { UserProfile } from "@shared/schema";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

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
  aiSection?: boolean;
  dangerSection?: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function itemIsActive(location: string, url: string): boolean {
  return location === url || location.startsWith(url + "/");
}

function sectionIsActive(location: string, items: NavItem[]): boolean {
  return items.some((item) => itemIsActive(location, item.url));
}

const STORAGE_KEY = "sidebar_open_sections";

function loadOpenSections(): Set<string> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return new Set(JSON.parse(saved));
  } catch {}
  return new Set(["home"]);
}

function saveOpenSections(sections: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...sections]));
  } catch {}
}

// ── Accordion Section Component ────────────────────────────────────────────────

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
        data-testid={`section-${section.id}`}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors",
          section.aiSection
            ? "text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20"
            : section.dangerSection
            ? "text-destructive hover:bg-destructive/10"
            : "text-muted-foreground hover:bg-muted/60",
          active && !section.dangerSection && !section.aiSection
            ? "text-foreground"
            : "",
          active && section.aiSection
            ? "text-violet-700 dark:text-violet-300"
            : ""
        )}
      >
        <span className="flex items-center gap-1.5">
          <section.icon
            className={cn(
              "h-3.5 w-3.5",
              section.aiSection ? "text-violet-500" : "",
              section.dangerSection ? "text-destructive" : ""
            )}
          />
          {section.label}
          {active && (
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                section.aiSection ? "bg-violet-500" : "bg-primary"
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
          {section.items.map((item) => {
            const active = itemIsActive(location, item.url);
            return (
              <Link
                key={item.url}
                href={item.url}
                onClick={onNavClick}
                data-testid={item.testId}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ml-1",
                  active
                    ? section.aiSection
                      ? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium"
                      : "bg-primary/10 text-primary font-medium"
                    : "text-foreground/70 hover:text-foreground hover:bg-muted/60"
                )}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 flex-shrink-0",
                    active
                      ? section.aiSection
                        ? "text-violet-600 dark:text-violet-400"
                        : "text-primary"
                      : "text-muted-foreground"
                  )}
                />
                <span className="truncate">{item.title}</span>
                {active && (
                  <span
                    className={cn(
                      "ml-auto h-1.5 w-1.5 rounded-full flex-shrink-0",
                      section.aiSection ? "bg-violet-500" : "bg-primary"
                    )}
                  />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AppSidebar() {
  const [location] = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const { toast } = useToast();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(loadOpenSections);

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: isAuthenticated,
  });

  const role = profile?.role || "CLIENT";
  const orgId = profile?.organizationId;

  const { data: organization, isLoading: orgLoading } = useQuery<{
    name: string;
    logoUrl?: string | null;
    coachTransactionsVisible?: boolean;
    athleticEnabled?: boolean;
  }>({
    queryKey: ["/api/organizations/by-id", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${orgId}`);
      if (!res.ok) throw new Error("Failed to fetch org");
      return res.json();
    },
    enabled: !!orgId,
  });

  const deleteOrgMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/organizations/${orgId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Organization deleted", description: "Your organization has been permanently deleted." });
      clearAuthToken();
      window.location.href = "/";
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to delete organization", variant: "destructive" });
    },
  });

  const athleticEnabled = (organization as any)?.athleticEnabled === true;
  const coachTransactionsVisible = (organization as any)?.coachTransactionsVisible !== false;

  const { data: athleticProgramsSidebar } = useQuery<any[]>({
    queryKey: ["/api/athletic/programs", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/athletic/programs?orgId=${orgId}`);
      return res.json();
    },
    enabled: !!orgId && athleticEnabled,
  });

  const activeAthleticPrograms = athleticProgramsSidebar?.filter((p: any) => p.active) || [];

  // ── Build sections ─────────────────────────────────────────────────────────

  const isCoachOrAdmin = role === "COACH" || role === "ADMIN";
  const isAdmin = role === "ADMIN";

  const coachAdminSections: NavSection[] = [
    {
      id: "home",
      label: "Home",
      icon: Home,
      items: [
        { title: "Command Center", url: "/command-center", icon: Flame, testId: "nav-command-center" },
        { title: "Dashboard", url: "/coach", icon: LayoutDashboard, testId: "nav-dashboard" },
      ],
    },
    {
      id: "clients",
      label: "Clients & Scheduling",
      icon: Users,
      items: [
        { title: "Coaches", url: "/coaches", icon: UserCog, testId: "nav-coaches" },
        { title: "Users", url: "/coach/users", icon: Users, testId: "nav-users" },
        { title: "Schedule", url: "/scheduling", icon: CalendarDays, testId: "nav-scheduling" },
        { title: "Availability", url: "/coach/availability", icon: CalendarClock, testId: "nav-availability" },
        { title: "Group Sessions", url: "/sessions", icon: UsersRound, testId: "nav-group-sessions" },
        { title: "Team Training", url: "/team-training", icon: Dumbbell, testId: "nav-team-training" },
        { title: "My Bookings", url: "/bookings", icon: Calendar, testId: "nav-my-bookings" },
        { title: "Redemptions", url: "/coach/redemptions", icon: DollarSign, testId: "nav-redemptions" },
        ...(coachTransactionsVisible
          ? [{ title: "Transactions", url: "/coach/transactions", icon: Wallet, testId: "nav-transactions" }]
          : []),
        ...(athleticEnabled
          ? [{
              title: activeAthleticPrograms.length === 1 ? activeAthleticPrograms[0]?.name || "Athletic" : "Athletic",
              url: "/coach/athletic",
              icon: Trophy,
              testId: "nav-athletic",
            }]
          : []),
        { title: "My Profile", url: "/coach/profile", icon: UserCog, testId: "nav-my-profile" },
      ],
    },
    {
      id: "growth",
      label: "Growth & Revenue",
      icon: TrendingUp,
      items: [
        ...(isAdmin
          ? [
              { title: "Team Training Leads", url: "/admin/team-training-leads", icon: Target, testId: "nav-team-training-leads" },
              { title: "Deal Pipeline", url: "/admin/team-training-deals", icon: KanbanSquare, testId: "nav-deal-pipeline" },
            ]
          : []),
        { title: "Outreach Center", url: "/coach/communications", icon: Radio, testId: "nav-outreach-center" },
        { title: "Business Plan", url: "/coach/business-plan", icon: Briefcase, testId: "nav-business-plan" },
        { title: "Team Quotes", url: "/coach/team-quotes", icon: FileText, testId: "nav-team-quotes" },
      ],
    },
    ...(isAdmin
      ? [
          {
            id: "ai-ops",
            label: "AI Operations",
            icon: Cpu,
            aiSection: true,
            items: [
              { title: "Business Brain", url: "/admin/business-brain", icon: Brain, testId: "nav-business-brain" },
              { title: "Agent Ops Monitor", url: "/admin/agent-ops", icon: ShieldAlert, testId: "nav-agent-ops" },
              { title: "Workflows", url: "/admin/workflows", icon: GitBranch, testId: "nav-workflows" },
              { title: "Trigger Audit", url: "/admin/trigger-audit", icon: Activity, testId: "nav-trigger-audit" },
              { title: "Agent Tools", url: "/admin/agent-tools", icon: Plug, testId: "nav-agent-tools" },
            ],
          } as NavSection,
          {
            id: "organization",
            label: "Organization",
            icon: Building2,
            items: [
              { title: "Branding", url: "/admin/branding", icon: Paintbrush, testId: "nav-branding" },
              { title: "Media Library", url: "/admin/media", icon: ImagePlay, testId: "nav-media" },
              { title: "Stripe", url: "/admin/stripe", icon: CreditCard, testId: "nav-stripe" },
              { title: "Subscription", url: "/admin/subscription", icon: Sparkles, testId: "nav-subscription" },
              { title: "Options", url: "/admin/configuration", icon: Settings, testId: "nav-options" },
            ],
          } as NavSection,
        ]
      : []),
  ];

  const clientItems: NavItem[] = [
    { title: "Coaches", url: "/coaches", icon: Users, testId: "nav-coaches" },
    { title: "Group Sessions", url: "/sessions", icon: UsersRound, testId: "nav-group-sessions" },
    { title: "Team Training", url: "/team-training", icon: Dumbbell, testId: "nav-team-training" },
    { title: "My Bookings", url: "/bookings", icon: Calendar, testId: "nav-my-bookings" },
    { title: "My Wallet", url: "/wallet", icon: Wallet, testId: "nav-my-wallet" },
    { title: "Scheduling Agent", url: "/scheduling/agent", icon: Bot, testId: "nav-scheduling-agent" },
    { title: "Settings", url: "/settings", icon: Settings, testId: "nav-settings" },
  ];

  // ── Auto-expand section when active route belongs to it ────────────────────

  useEffect(() => {
    if (!isCoachOrAdmin) return;
    const activeSection = coachAdminSections.find((s) => sectionIsActive(location, s.items));
    if (activeSection && !openSections.has(activeSection.id)) {
      setOpenSections((prev) => {
        const next = new Set(prev);
        next.add(activeSection.id);
        saveOpenSections(next);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, role]);

  // ── Toggle section ─────────────────────────────────────────────────────────

  const toggleSection = useCallback(
    (id: string) => {
      setOpenSections((prev) => {
        let next: Set<string>;
        if (isMobile) {
          next = prev.has(id) ? new Set<string>() : new Set([id]);
        } else {
          next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
        }
        saveOpenSections(next);
        return next;
      });
    },
    [isMobile]
  );

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Sidebar>
        {/* Logo / Org name */}
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

        <SidebarContent className="px-2 py-2">
          {isCoachOrAdmin ? (
            <div className="space-y-0.5">
              {coachAdminSections.map((section) => (
                <AccordionSection
                  key={section.id}
                  section={section}
                  isOpen={openSections.has(section.id)}
                  onToggle={toggleSection}
                  location={location}
                  onNavClick={handleNavClick}
                />
              ))}

              {/* Danger Zone – always visible, no accordion needed */}
              {isAdmin && (
                <div className="mt-2 pt-2 border-t border-border/50">
                  <button
                    onClick={() => setDeleteDialogOpen(true)}
                    data-testid="button-delete-organization"
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-4 w-4 flex-shrink-0" />
                    <span>Delete Organization</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* CLIENT role – flat list */
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
                    {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />}
                  </Link>
                );
              })}
            </div>
          )}
        </SidebarContent>

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
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 flex-shrink-0"
                data-testid="button-logout"
                onClick={() => logout()}
              >
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </SidebarFooter>
      </Sidebar>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-delete-dialog-title">Are you sure?</AlertDialogTitle>
            <AlertDialogDescription data-testid="text-delete-dialog-description">
              This will permanently delete your organization, all services, coach profiles, and user data associated
              with it. If you have an active subscription, it will also be canceled. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteOrgMutation.mutate()}
              disabled={deleteOrgMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-confirm"
            >
              {deleteOrgMutation.isPending ? "Deleting..." : "Delete Organization"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
