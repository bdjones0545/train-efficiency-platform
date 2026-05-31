import { useState, useEffect, useCallback, createContext, useContext } from "react";
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
  Shield,
  ShieldAlert,
  Home,
  TrendingUp,
  Cpu,
  Building2,
  ChevronDown,
  Radio,
  Pin,
  PinOff,
  Inbox,
  Clock,
  Lock,
  Sliders,
  BarChart2,
  ClipboardList,
  Layers,
  Zap,
  Lightbulb,
  Wrench,
  Eye,
  Globe,
  Rocket,
  UserCheck,
  CheckCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { clearAuthToken } from "@/lib/authToken";
import { setLastOrgSlug } from "@/lib/logout";
import logoImg from "@assets/IMG_7961_1771105509253.jpeg";
import type { UserProfile } from "@shared/schema";
import { cn } from "@/lib/utils";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type WorkspaceMode = "simplified" | "advanced";

type NavItem = {
  title: string;
  simplifiedTitle?: string;
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
  lowPriority?: boolean;
};

type NavRef = { url: string; title: string };

type AiSubGroup = {
  id: string;
  label: string;
  icon: React.ElementType;
  items: NavItem[];
  standardVisible: boolean;
  defaultOpen: boolean;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Storage helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const OPEN_KEY = "sidebar_open_sections";
const MODE_KEY = "workspace_mode";
const PINNED_KEY = "nav_pinned";
const RECENTS_KEY = "nav_recents";
const AI_OUTER_KEY = "ai_ops_outer_open";
const AI_SUB_KEY = "ai_ops_subgroups_open";
const GR_OUTER_KEY = "gr_outer_open";
const GR_SUB_KEY = "gr_subgroups_open";
const MAX_RECENTS = 5;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI Operations sub-group definitions (static — no component state)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const AI_SUB_GROUPS: AiSubGroup[] = [
  {
    id: "ai-intelligence",
    label: "Intelligence",
    icon: Lightbulb,
    standardVisible: true,
    defaultOpen: true,
    items: [
      { title: "CEO Heartbeat", simplifiedTitle: "CEO Heartbeat", url: "/admin/ceo-heartbeat", icon: Brain, testId: "nav-ceo-heartbeat" },
      { title: "Athlete Intelligence", simplifiedTitle: "Athlete AI", url: "/admin/athlete-intelligence", icon: Dumbbell, testId: "nav-athlete-intelligence" },
      { title: "Command Center", simplifiedTitle: "AI Overview", url: "/admin/ai-operations", icon: Cpu, testId: "nav-ai-operations" },
      { title: "AI Comms Center", simplifiedTitle: "AI Comms", url: "/admin/ai-approvals", icon: CheckCheck, testId: "nav-ai-approvals" },
      { title: "Outreach Opportunities", simplifiedTitle: "Outreach", url: "/admin/ai-outreach-opportunities", icon: Target, testId: "nav-ai-outreach-opportunities" },
      { title: "Attention Inbox", simplifiedTitle: "Attention", url: "/admin/attention", icon: Inbox, testId: "nav-attention-inbox" },
      { title: "Business Brain", simplifiedTitle: "Business Brain", url: "/admin/business-brain", icon: Brain, testId: "nav-business-brain" },
      { title: "Recommendations", simplifiedTitle: "Suggestions", url: "/admin/recommendations", icon: Zap, testId: "nav-recommendations" },
      { title: "Workflow Heatmap", simplifiedTitle: "Heatmap", url: "/admin/workflow-heatmap", icon: BarChart2, testId: "nav-workflow-heatmap" },
      { title: "Scheduling Command Center", simplifiedTitle: "Sched. Hub", url: "/admin/scheduling-command-center", icon: CalendarDays, testId: "nav-scheduling-command-center" },
      { title: "Coach Capacity", simplifiedTitle: "Capacity", url: "/admin/coach-capacity", icon: BarChart2, testId: "nav-coach-capacity" },
      { title: "Opportunity Inbox", simplifiedTitle: "Opportunities", url: "/admin/scheduling-opportunity-inbox", icon: Inbox, testId: "nav-scheduling-opportunity-inbox" },
      { title: "Scheduling Copilot", simplifiedTitle: "AI Copilot", url: "/admin/scheduling-copilot", icon: Sparkles, testId: "nav-scheduling-copilot" },
    ],
  },
  {
    id: "ai-automation",
    label: "Automation",
    icon: GitBranch,
    standardVisible: false,
    defaultOpen: false,
    items: [
      { title: "Workflow Orchestrator", simplifiedTitle: "Orchestration", url: "/admin/workflow-orchestrator", icon: Activity, testId: "nav-workflow-orchestrator" },
      { title: "Workflows", simplifiedTitle: "Automations", url: "/admin/workflows", icon: GitBranch, testId: "nav-workflows" },
      { title: "AI Workforce", simplifiedTitle: "Workforce", url: "/admin/ai-workforce", icon: Users, testId: "nav-ai-workforce" },
      { title: "Autonomy Controls", simplifiedTitle: "Autonomy", url: "/admin/autonomy-controls", icon: Sliders, testId: "nav-autonomy-controls" },
    ],
  },
  {
    id: "ai-build",
    label: "Build & Configure",
    icon: Wrench,
    standardVisible: false,
    defaultOpen: false,
    items: [
      { title: "Workflow Builder", simplifiedTitle: "Builder", url: "/admin/workflow-builder", icon: Zap, testId: "nav-workflow-builder" },
      { title: "Workflow Library", simplifiedTitle: "Library", url: "/admin/workflows-library", icon: Layers, testId: "nav-workflows-library" },
      { title: "Agent Tools", simplifiedTitle: "AI Tools", url: "/admin/agent-tools", icon: Plug, testId: "nav-agent-tools" },
    ],
  },
  {
    id: "ai-monitoring",
    label: "Monitoring",
    icon: Eye,
    standardVisible: false,
    defaultOpen: false,
    items: [
      { title: "Agent Ops Monitor", simplifiedTitle: "System Health", url: "/admin/agent-ops", icon: ShieldAlert, testId: "nav-agent-ops" },
      { title: "Trigger Audit", simplifiedTitle: "Activity Log", url: "/admin/trigger-audit", icon: Activity, testId: "nav-trigger-audit" },
      { title: "AI Governance", simplifiedTitle: "Governance", url: "/admin/ai-governance", icon: Shield, testId: "nav-ai-governance" },
      { title: "Launch Readiness",   simplifiedTitle: "Launch",    url: "/admin/launch-readiness",  icon: Rocket,   testId: "nav-launch-readiness" },
      { title: "Ecosystem Health",   simplifiedTitle: "Ecosystem", url: "/admin/ecosystem-health", icon: Activity, testId: "nav-ecosystem-health" },
      { title: "Community",              simplifiedTitle: "Community",   url: "/community",                       icon: Globe,    testId: "nav-community" },
      { title: "Marketplace Activation", simplifiedTitle: "Activation",  url: "/admin/marketplace-activation",    icon: Rocket,   testId: "nav-marketplace-activation" },
      { title: "Agent Economy",          simplifiedTitle: "Economy",     url: "/admin/agent-economy",             icon: Activity, testId: "nav-agent-economy" },
      { title: "Ecosystem Outreach",     simplifiedTitle: "Outreach",    url: "/admin/ecosystem-outreach",        icon: Globe,    testId: "nav-ecosystem-outreach" },
      { title: "Community Leaderboards", simplifiedTitle: "Leaderboards",url: "/community/leaderboards",          icon: Trophy,   testId: "nav-community-leaderboards" },
      { title: "Hall of Fame",           simplifiedTitle: "Hall of Fame",url: "/community/hall-of-fame",          icon: Trophy,   testId: "nav-hall-of-fame" },
      { title: "Developer Recruitment",  simplifiedTitle: "Dev Recruit", url: "/admin/developer-recruitment",     icon: Users,    testId: "nav-developer-recruitment" },
      { title: "Org Recruitment",        simplifiedTitle: "Org Recruit", url: "/admin/org-recruitment",           icon: Building2,testId: "nav-org-recruitment" },
      { title: "Marketplace Proof",      simplifiedTitle: "Proof",       url: "/admin/marketplace-proof",         icon: Shield,   testId: "nav-marketplace-proof" },
      { title: "Human Validation",       simplifiedTitle: "Validation",  url: "/admin/human-validation",          icon: UserCheck,testId: "nav-human-validation" },
      { title: "First 10 Users",         simplifiedTitle: "First 10",    url: "/admin/first-10",                  icon: Target,   testId: "nav-first-10" },
    ],
  },
  {
    id: "ai-integrations",
    label: "Integrations",
    icon: Globe,
    standardVisible: false,
    defaultOpen: false,
    items: [
      { title: "Gmail Conversations", simplifiedTitle: "Gmail", url: "/admin/gmail-conversations", icon: Inbox, testId: "nav-gmail-conversations" },
    ],
  },
];

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

function loadOpenSections(isMobile: boolean): Set<string> {
  if (isMobile) return new Set(["home"]);
  return new Set(ls<string[]>(OPEN_KEY, ["home"]));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sidebar Context (avoids prop-drilling for pinning)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type SidebarCtx = {
  pinned: NavRef[];
  isPinned: (url: string) => boolean;
  togglePin: (ref: NavRef) => void;
  workspaceMode: WorkspaceMode;
};

const SidebarContext = createContext<SidebarCtx>({
  pinned: [],
  isPinned: () => false,
  togglePin: () => {},
  workspaceMode: "simplified",
});

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
// NavLink – single nav item with pin button
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function NavLink({
  item,
  location,
  onClick,
  aiSection = false,
  useSimplifiedTitle = false,
}: {
  item: NavItem;
  location: string;
  onClick: () => void;
  aiSection?: boolean;
  useSimplifiedTitle?: boolean;
}) {
  const { isPinned, togglePin } = useContext(SidebarContext);
  const active = itemIsActive(location, item.url);
  const pinned = isPinned(item.url);
  const label = useSimplifiedTitle && item.simplifiedTitle ? item.simplifiedTitle : item.title;

  return (
    <div className="group relative flex items-center">
      <Link
        href={item.url}
        onClick={onClick}
        data-testid={item.testId}
        className={cn(
          "flex-1 flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ml-1 pr-8",
          active
            ? aiSection
              ? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium"
              : "bg-primary/10 text-primary font-medium"
            : "text-foreground/70 hover:text-foreground hover:bg-muted/60"
        )}
      >
        <item.icon
          className={cn(
            "h-4 w-4 flex-shrink-0",
            active
              ? aiSection
                ? "text-violet-600 dark:text-violet-400"
                : "text-primary"
              : "text-muted-foreground"
          )}
        />
        <span className="truncate">{label}</span>
        {active && (
          <span
            className={cn(
              "ml-auto h-1.5 w-1.5 rounded-full flex-shrink-0",
              aiSection ? "bg-violet-500" : "bg-primary"
            )}
          />
        )}
      </Link>

      {/* Pin button – visible on hover (desktop) or always if pinned */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          togglePin({ url: item.url, title: item.title });
        }}
        data-testid={`pin-${item.testId}`}
        title={pinned ? "Unpin" : "Pin to Quick Access"}
        className={cn(
          "absolute right-1.5 h-5 w-5 rounded flex items-center justify-center transition-all",
          "text-muted-foreground hover:text-foreground hover:bg-muted",
          pinned
            ? "opacity-100 text-primary"
            : "opacity-0 group-hover:opacity-100"
        )}
      >
        {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
      </button>
    </div>
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
}: {
  section: NavSection;
  isOpen: boolean;
  onToggle: (id: string) => void;
  location: string;
  onNavClick: () => void;
}) {
  const { workspaceMode } = useContext(SidebarContext);
  const active = sectionIsActive(location, section.items);
  const simplified = workspaceMode === "simplified";

  return (
    <div className="mb-0.5">
      <button
        onClick={() => onToggle(section.id)}
        data-testid={`section-${section.id}`}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors",
          section.aiSection
            ? "text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20"
            : "text-muted-foreground hover:bg-muted/60",
          active && !section.aiSection ? "text-foreground" : "",
          active && section.aiSection ? "text-violet-700 dark:text-violet-300" : ""
        )}
      >
        <span className="flex items-center gap-1.5">
          <section.icon
            className={cn("h-3.5 w-3.5", section.aiSection ? "text-violet-500" : "")}
          />
          {section.label}
          {section.aiSection && simplified && (
            <span className="ml-1 text-[9px] font-medium px-1 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 uppercase tracking-wide leading-none">
              Adv
            </span>
          )}
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
          isOpen ? "max-h-[700px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="mt-0.5 space-y-0.5 pb-1">
          {section.items.map((item) => (
            <NavLink
              key={item.url}
              item={item}
              location={location}
              onClick={onNavClick}
              aiSection={section.aiSection}
              useSimplifiedTitle={simplified && !!section.aiSection}
            />
          ))}

          {/* AI section footer in simplified mode */}
          {section.aiSection && simplified && (
            <p className="ml-1 px-3 pt-1 pb-0.5 text-[10px] text-muted-foreground/70 leading-relaxed">
              Switch to Advanced workspace to configure internals.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AiOpsNavSection – nested grouped navigation for AI Operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function AiOpsNavSection({
  location,
  onNavClick,
}: {
  location: string;
  onNavClick: () => void;
}) {
  const { workspaceMode } = useContext(SidebarContext);
  const { isMobile } = useSidebar();
  const isSimplified = workspaceMode === "simplified";

  const isAnyAiActive = AI_SUB_GROUPS.some((g) =>
    g.items.some((i) => itemIsActive(location, i.url))
  );

  const [outerOpen, setOuterOpen] = useState<boolean>(() => {
    if (isAnyAiActive) return true;
    return ls<boolean>(AI_OUTER_KEY, false);
  });

  const [subOpen, setSubOpen] = useState<Set<string>>(() =>
    new Set(ls<string[]>(AI_SUB_KEY, ["ai-intelligence"]))
  );

  useEffect(() => {
    if (isAnyAiActive && !outerOpen) {
      setOuterOpen(true);
      lsSet(AI_OUTER_KEY, true);
    }
    AI_SUB_GROUPS.forEach((group) => {
      if (group.items.some((i) => itemIsActive(location, i.url))) {
        setSubOpen((prev) => {
          if (prev.has(group.id)) return prev;
          const next = new Set(prev);
          next.add(group.id);
          lsSet(AI_SUB_KEY, [...next]);
          return next;
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const toggleOuter = () => {
    setOuterOpen((prev) => {
      lsSet(AI_OUTER_KEY, !prev);
      return !prev;
    });
  };

  const toggleSub = (id: string) => {
    setSubOpen((prev) => {
      let next: Set<string>;
      if (isMobile) {
        next = prev.has(id) ? new Set<string>() : new Set([id]);
      } else {
        next = new Set(prev);
        prev.has(id) ? next.delete(id) : next.add(id);
      }
      lsSet(AI_SUB_KEY, [...next]);
      return next;
    });
  };

  const visibleGroups = isSimplified
    ? AI_SUB_GROUPS.filter((g) => g.standardVisible)
    : AI_SUB_GROUPS;

  return (
    <div className="mb-0.5">
      {/* Outer AI Operations header */}
      <button
        onClick={toggleOuter}
        data-testid="section-ai-ops"
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors",
          "text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20",
          isAnyAiActive ? "text-violet-700 dark:text-violet-300" : ""
        )}
      >
        <span className="flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5 text-violet-500" />
          AI Operations
          {isSimplified && (
            <span className="ml-1 text-[9px] font-medium px-1 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 uppercase tracking-wide leading-none">
              Adv
            </span>
          )}
          {isAnyAiActive && (
            <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
          )}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200",
            outerOpen ? "rotate-180" : ""
          )}
        />
      </button>

      {/* Sub-groups */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-in-out",
          outerOpen ? "max-h-[1400px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="mt-0.5 space-y-0.5 pb-1 pl-2">
          {visibleGroups.map((group) => {
            const groupActive = group.items.some((i) =>
              itemIsActive(location, i.url)
            );
            const isOpen = subOpen.has(group.id);

            return (
              <div key={group.id}>
                {/* Sub-group header */}
                <button
                  onClick={() => toggleSub(group.id)}
                  data-testid={`section-${group.id}`}
                  className={cn(
                    "w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors",
                    groupActive
                      ? "text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/20"
                      : "text-violet-500 dark:text-violet-500 hover:bg-violet-50/60 dark:hover:bg-violet-900/10"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <group.icon className="h-3 w-3" />
                    {group.label}
                    <span className="text-[9px] font-medium px-1 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-500 leading-none">
                      {group.items.length}
                    </span>
                    {groupActive && (
                      <span className="h-1 w-1 rounded-full bg-violet-500" />
                    )}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform duration-200",
                      isOpen ? "rotate-180" : ""
                    )}
                  />
                </button>

                {/* Sub-group items */}
                <div
                  className={cn(
                    "overflow-hidden transition-all duration-200 ease-in-out",
                    isOpen ? "max-h-[400px] opacity-100" : "max-h-0 opacity-0"
                  )}
                >
                  <div className="mt-0.5 space-y-0.5 pb-0.5">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.url}
                        item={item}
                        location={location}
                        onClick={onNavClick}
                        aiSection={true}
                        useSimplifiedTitle={isSimplified}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {isSimplified && (
            <p className="px-2 pt-1 pb-0.5 text-[10px] text-muted-foreground/70 leading-relaxed">
              Switch to Advanced workspace to access automation & monitoring tools.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GrowthRevenueNavSection – nested grouped navigation for Growth & Revenue
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildGrSubGroups(isAdmin: boolean, coachTransactionsVisible: boolean): AiSubGroup[] {
  return [
    {
      id: "gr-lead-generation",
      label: "Lead Generation",
      icon: Target,
      standardVisible: true,
      defaultOpen: true,
      items: isAdmin
        ? [
            { title: "Athlete Leads", url: "/admin/athlete-leads", icon: Users, testId: "nav-athlete-leads" },
            { title: "Team Training Leads", url: "/admin/team-training-leads", icon: Target, testId: "nav-team-training-leads" },
            { title: "Outreach Center", url: "/admin/outreach-center", icon: Radio, testId: "nav-outreach-center-admin" },
          ]
        : [
            { title: "Outreach Center", url: "/coach/communications", icon: Radio, testId: "nav-outreach-center" },
          ],
    },
    {
      id: "gr-sales-pipeline",
      label: "Sales Pipeline",
      icon: KanbanSquare,
      standardVisible: true,
      defaultOpen: false,
      items: [
        ...(isAdmin
          ? [
              { title: "Deal Pipeline", url: "/admin/team-training-deals", icon: KanbanSquare, testId: "nav-deal-pipeline" },
              { title: "Team Quotes", url: "/coach/team-quotes", icon: FileText, testId: "nav-team-quotes" },
              { title: "Lead Pipeline", url: "/admin/lead-pipeline", icon: TrendingUp, testId: "nav-lead-pipeline" },
            ]
          : [
              { title: "Team Quotes", url: "/coach/team-quotes", icon: FileText, testId: "nav-team-quotes" },
            ]
        ),
      ],
    },
    {
      id: "gr-revenue-management",
      label: "Revenue Management",
      icon: Wallet,
      standardVisible: true,
      defaultOpen: false,
      items: [
        ...(coachTransactionsVisible
          ? [{ title: "Transactions", url: "/coach/transactions", icon: Wallet, testId: "nav-transactions" }]
          : []),
        { title: "Redemptions", url: "/coach/redemptions", icon: DollarSign, testId: "nav-redemptions" },
      ],
    },
    {
      id: "gr-business-planning",
      label: "Business Planning",
      icon: Briefcase,
      standardVisible: true,
      defaultOpen: false,
      items: [
        { title: "Business Plan", url: "/coach/business-plan", icon: Briefcase, testId: "nav-business-plan" },
      ],
    },
  ];
}

function GrowthRevenueNavSection({
  location,
  onNavClick,
  isAdmin,
  coachTransactionsVisible,
}: {
  location: string;
  onNavClick: () => void;
  isAdmin: boolean;
  coachTransactionsVisible: boolean;
}) {
  const { isMobile } = useSidebar();
  const grSubGroups = buildGrSubGroups(isAdmin, coachTransactionsVisible);

  const isAnyGrActive = grSubGroups.some((g) =>
    g.items.some((i) => itemIsActive(location, i.url))
  );

  const [outerOpen, setOuterOpen] = useState<boolean>(() => {
    if (isAnyGrActive) return true;
    return ls<boolean>(GR_OUTER_KEY, false);
  });

  const [subOpen, setSubOpen] = useState<Set<string>>(() => {
    const saved = ls<string[]>(GR_SUB_KEY, ["gr-lead-generation"]);
    return new Set(saved);
  });

  useEffect(() => {
    if (isAnyGrActive && !outerOpen) {
      setOuterOpen(true);
      lsSet(GR_OUTER_KEY, true);
    }
    grSubGroups.forEach((group) => {
      if (group.items.some((i) => itemIsActive(location, i.url))) {
        setSubOpen((prev) => {
          if (prev.has(group.id)) return prev;
          const next = new Set(prev);
          next.add(group.id);
          lsSet(GR_SUB_KEY, [...next]);
          return next;
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const toggleOuter = () => {
    setOuterOpen((prev) => {
      lsSet(GR_OUTER_KEY, !prev);
      return !prev;
    });
  };

  const toggleSub = (id: string) => {
    setSubOpen((prev) => {
      let next: Set<string>;
      if (isMobile) {
        next = prev.has(id) ? new Set<string>() : new Set([id]);
      } else {
        next = new Set(prev);
        prev.has(id) ? next.delete(id) : next.add(id);
      }
      lsSet(GR_SUB_KEY, [...next]);
      return next;
    });
  };

  return (
    <div className="mb-0.5">
      {/* Outer Growth & Revenue header */}
      <button
        onClick={toggleOuter}
        data-testid="section-growth-revenue"
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors",
          "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20",
          isAnyGrActive ? "text-emerald-700 dark:text-emerald-300" : ""
        )}
      >
        <span className="flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
          Growth & Revenue
          {isAnyGrActive && (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          )}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200",
            outerOpen ? "rotate-180" : ""
          )}
        />
      </button>

      {/* Sub-groups */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-in-out",
          outerOpen ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="mt-0.5 space-y-0.5 pb-1 pl-2">
          {grSubGroups.map((group) => {
            if (group.items.length === 0) return null;
            const groupActive = group.items.some((i) => itemIsActive(location, i.url));
            const isOpen = subOpen.has(group.id);

            return (
              <div key={group.id}>
                {/* Sub-group header */}
                <button
                  onClick={() => toggleSub(group.id)}
                  data-testid={`section-${group.id}`}
                  className={cn(
                    "w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors",
                    groupActive
                      ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20"
                      : "text-emerald-500 dark:text-emerald-500 hover:bg-emerald-50/60 dark:hover:bg-emerald-900/10"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <group.icon className="h-3 w-3" />
                    {group.label}
                    <span className="text-[9px] font-medium px-1 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-500 leading-none">
                      {group.items.length}
                    </span>
                    {groupActive && (
                      <span className="h-1 w-1 rounded-full bg-emerald-500" />
                    )}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform duration-200",
                      isOpen ? "rotate-180" : ""
                    )}
                  />
                </button>

                {/* Sub-group items */}
                <div
                  className={cn(
                    "overflow-hidden transition-all duration-200 ease-in-out",
                    isOpen ? "max-h-[400px] opacity-100" : "max-h-0 opacity-0"
                  )}
                >
                  <div className="mt-0.5 space-y-0.5 pb-0.5">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.url}
                        item={item}
                        location={location}
                        onClick={onNavClick}
                        aiSection={false}
                        useSimplifiedTitle={false}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AttentionCountChip – single compact badge pointing to Attention Inbox
// Replaces multiple duplicate alert strips; bell + inbox are the source of truth
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
          {badgeCount} item{badgeCount !== 1 ? "s" : ""} need{badgeCount === 1 ? "s" : ""} attention
        </span>
        <span className={cn(
          "flex-shrink-0 font-bold text-[10px] px-1.5 py-0.5 rounded-full",
          criticalCount > 0
            ? "bg-red-500 text-white"
            : "bg-amber-500 text-white"
        )}>
          {badgeCount}
        </span>
      </Link>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// QuickAccess – Recent + Pinned strip
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function QuickAccess({
  recents,
  allItems,
  location,
  onNavClick,
}: {
  recents: NavRef[];
  allItems: NavItem[];
  location: string;
  onNavClick: () => void;
}) {
  const { pinned, togglePin } = useContext(SidebarContext);

  const resolveItem = (ref: NavRef) =>
    allItems.find((i) => i.url === ref.url) ?? {
      title: ref.title,
      url: ref.url,
      icon: Clock,
      testId: `nav-recent-${ref.url.replace(/\//g, "-")}`,
    };

  const showPinned = pinned.length > 0;
  const showRecents = recents.filter((r) => !pinned.find((p) => p.url === r.url)).length > 0;

  if (!showPinned && !showRecents) return null;

  return (
    <div className="mb-3 pb-2 border-b border-border/40">
      {showPinned && (
        <div className="mb-1.5">
          <p className="px-3 mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1">
            <Pin className="h-2.5 w-2.5" /> Pinned
          </p>
          <div className="space-y-0.5">
            {pinned.map((ref) => {
              const item = resolveItem(ref);
              const active = itemIsActive(location, item.url);
              return (
                <div key={ref.url} className="group relative flex items-center">
                  <Link
                    href={item.url}
                    onClick={onNavClick}
                    data-testid={`pinned-${item.testId ?? ref.url}`}
                    className={cn(
                      "flex-1 flex items-center gap-2 px-3 py-1 rounded-md text-xs transition-colors pr-7",
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground/70 hover:text-foreground hover:bg-muted/60"
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate">{item.title}</span>
                  </Link>
                  <button
                    onClick={() => togglePin(ref)}
                    title="Unpin"
                    className="absolute right-1.5 h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-all"
                    data-testid={`unpin-${ref.url.replace(/\//g, "-")}`}
                  >
                    <PinOff className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showRecents && (
        <div>
          <p className="px-3 mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" /> Recent
          </p>
          <div className="space-y-0.5">
            {recents
              .filter((r) => !pinned.find((p) => p.url === r.url))
              .slice(0, 4)
              .map((ref) => {
                const item = resolveItem(ref);
                const active = itemIsActive(location, item.url);
                return (
                  <Link
                    key={ref.url}
                    href={item.url}
                    onClick={onNavClick}
                    data-testid={`recent-${item.testId ?? ref.url}`}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1 rounded-md text-xs transition-colors",
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground/70 hover:text-foreground hover:bg-muted/60"
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate">{item.title}</span>
                  </Link>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WorkspaceModeToggle
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function WorkspaceModeToggle({
  mode,
  onChange,
}: {
  mode: WorkspaceMode;
  onChange: (m: WorkspaceMode) => void;
}) {
  const simplified = mode === "simplified";

  return (
    <div className="mx-2 mb-2 rounded-md border border-border/50 bg-muted/30 p-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <Sliders className="h-3 w-3" />
          Workspace
        </span>
        <span
          className={cn(
            "text-[9px] font-medium px-1.5 py-0.5 rounded-full",
            simplified
              ? "bg-muted text-muted-foreground"
              : "bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400"
          )}
        >
          {simplified ? "Simplified" : "Advanced"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <button
          onClick={() => onChange("simplified")}
          data-testid="workspace-simplified"
          className={cn(
            "text-[10px] py-1 px-2 rounded transition-colors font-medium",
            simplified
              ? "bg-background text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
          )}
        >
          Simplified
        </button>
        <button
          onClick={() => onChange("advanced")}
          data-testid="workspace-advanced"
          className={cn(
            "text-[10px] py-1 px-2 rounded transition-colors font-medium flex items-center justify-center gap-1",
            !simplified
              ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800/50"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
          )}
        >
          {!simplified && <Lock className="h-2.5 w-2.5" />}
          Advanced
        </button>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AppSidebar – main component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function AppSidebar() {
  const [location] = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const { toast } = useToast();

  // ── State ────────────────────────────────────────────────────────────────────

  const [openSections, setOpenSections] = useState<Set<string>>(() =>
    loadOpenSections(isMobile)
  );
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceMode>(
    () => ls<WorkspaceMode>(MODE_KEY, "simplified")
  );
  const [pinned, setPinned] = useState<NavRef[]>(() => ls<NavRef[]>(PINNED_KEY, []));
  const [recents, setRecents] = useState<NavRef[]>(() => ls<NavRef[]>(RECENTS_KEY, []));

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
  const coachTransactionsVisible = (organization as any)?.coachTransactionsVisible !== false;

  const { data: athleticProgramsSidebar } = useQuery<any[]>({
    queryKey: ["/api/athletic/programs", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/athletic/programs?orgId=${orgId}`);
      return res.json();
    },
    enabled: !!orgId && athleticEnabled,
  });

  const activeAthleticPrograms = athleticProgramsSidebar?.filter((p: any) => p.active && (p.type === "scheduling" || !p.type)) || [];

  const orgSlug = (organization as any)?.slug || "";
  const activeProgramTools = athleticProgramsSidebar?.filter((p: any) => p.active && (p.type === "pr_tracker" || p.type === "workout_builder" || p.type === "lead_capture")) || [];
  const programToolItems: NavItem[] = orgSlug
    ? activeProgramTools.map((p: any) => ({
        title: p.name,
        url: p.type === "lead_capture" ? `/lead-capture/programs/${p.id}` : `/org/${orgSlug}/programs/${p.slug}`,
        icon: p.type === "pr_tracker" ? BarChart2 : p.type === "lead_capture" ? Zap : ClipboardList,
        testId: `nav-program-tool-${p.id}`,
      }))
    : [];

  // Persist org slug to localStorage so logout can redirect back to the org page
  useEffect(() => {
    if (orgSlug) setLastOrgSlug(orgSlug);
  }, [orgSlug]);

  // ── Attention count chip handled inline via AttentionCountChip component ─────

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Build section definitions
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // STAFF: limited Clients & Scheduling only
  const staffSections: NavSection[] = [
    {
      id: "clients",
      label: "Clients & Scheduling",
      icon: Users,
      items: [
        { title: "Coaches", url: "/coaches", icon: UserCog, testId: "nav-coaches" },
        { title: "Schedule", url: "/scheduling", icon: CalendarDays, testId: "nav-scheduling" },
        { title: "Group Sessions", url: "/sessions", icon: UsersRound, testId: "nav-group-sessions" },
        { title: "Team Training", url: "/team-training", icon: Dumbbell, testId: "nav-team-training" },
        { title: "My Bookings", url: "/bookings", icon: Calendar, testId: "nav-my-bookings" },
      ],
    },
  ];

  // COACH / ADMIN sections
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
        ...(athleticEnabled
          ? [{
              title:
                activeAthleticPrograms.length === 1
                  ? activeAthleticPrograms[0]?.name || "Athletic"
                  : "Athletic",
              url: "/coach/athletic",
              icon: Trophy,
              testId: "nav-athletic",
            }]
          : []),
        { title: "My Profile", url: "/coach/profile", icon: UserCog, testId: "nav-my-profile" },
      ],
    },
    ...(programToolItems.length > 0
      ? [{
          id: "program-tools",
          label: "Program Tools",
          icon: Layers,
          items: programToolItems,
        } as NavSection]
      : []),
    ...(isAdmin
      ? [
          {
            id: "organization",
            label: "Organization",
            icon: Building2,
            lowPriority: true,
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

  // CLIENT flat list
  const clientItems: NavItem[] = [
    { title: "Coaches", url: "/coaches", icon: Users, testId: "nav-coaches" },
    { title: "Group Sessions", url: "/sessions", icon: UsersRound, testId: "nav-group-sessions" },
    { title: "Team Training", url: "/team-training", icon: Dumbbell, testId: "nav-team-training" },
    { title: "My Bookings", url: "/bookings", icon: Calendar, testId: "nav-my-bookings" },
    { title: "My Wallet", url: "/wallet", icon: Wallet, testId: "nav-my-wallet" },
    { title: "Scheduling Agent", url: "/scheduling/agent", icon: Bot, testId: "nav-scheduling-agent" },
    { title: "Settings", url: "/settings", icon: Settings, testId: "nav-settings" },
  ];

  // All nav items across all roles (for recents lookup)
  const grSubGroupsForRecents = buildGrSubGroups(isAdmin, coachTransactionsVisible);
  const allNavItems: NavItem[] = [
    ...coachAdminSections.flatMap((s) => s.items),
    ...grSubGroupsForRecents.flatMap((g) => g.items),
    ...AI_SUB_GROUPS.flatMap((g) => g.items),
    ...staffSections.flatMap((s) => s.items),
    ...clientItems,
  ];

  // Active sections to use
  const activeSections = isCoachOrAdmin ? coachAdminSections : isStaff ? staffSections : [];

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Effects
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // Track recent pages
  useEffect(() => {
    const matched = allNavItems.find((i) => itemIsActive(location, i.url));
    if (!matched) return;
    const ref: NavRef = { url: matched.url, title: matched.title };
    setRecents((prev) => {
      const next = [ref, ...prev.filter((r) => r.url !== ref.url)].slice(0, MAX_RECENTS);
      lsSet(RECENTS_KEY, next);
      return next;
    });
  }, [location]);

  // Auto-expand parent section for active route
  useEffect(() => {
    if (activeSections.length === 0) return;
    const activeSection = activeSections.find((s) => sectionIsActive(location, s.items));
    if (activeSection && !openSections.has(activeSection.id)) {
      setOpenSections((prev) => {
        const next = new Set(prev);
        next.add(activeSection.id);
        lsSet(OPEN_KEY, [...next]);
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, role]);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Handlers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

  const setWorkspaceMode = useCallback((m: WorkspaceMode) => {
    lsSet(MODE_KEY, m);
    setWorkspaceModeState(m);
  }, []);

  const togglePin = useCallback((ref: NavRef) => {
    setPinned((prev) => {
      const exists = prev.find((p) => p.url === ref.url);
      const next = exists ? prev.filter((p) => p.url !== ref.url) : [...prev, ref];
      lsSet(PINNED_KEY, next);
      return next;
    });
  }, []);

  const isPinned = useCallback(
    (url: string) => !!pinned.find((p) => p.url === url),
    [pinned]
  );

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Render
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const ctxValue: SidebarCtx = { pinned, isPinned, togglePin, workspaceMode };

  return (
    <SidebarContext.Provider value={ctxValue}>
      <>
        <Sidebar>
          {/* ── Org header ────────────────────────────────────────────────────── */}
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
            {/* ── Attention count chip (coach/admin) ───────────────────────── */}
            {isCoachOrAdmin && (
              <AttentionCountChip role={role} onNavClick={handleNavClick} />
            )}

            {/* ── COACH / ADMIN sections ───────────────────────────────────── */}
            {isCoachOrAdmin && (
              <>
                {/* Quick Access (Recent + Pinned) */}
                <QuickAccess
                  recents={recents}
                  allItems={allNavItems}
                  location={location}
                  onNavClick={handleNavClick}
                />

                <div className="space-y-0.5 flex-1">
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

                  {/* Growth & Revenue grouped sub-navigation */}
                  <GrowthRevenueNavSection
                    location={location}
                    onNavClick={handleNavClick}
                    isAdmin={isAdmin}
                    coachTransactionsVisible={coachTransactionsVisible}
                  />

                  {/* AI Operations grouped sub-navigation (admin only) */}
                  {isAdmin && (
                    <AiOpsNavSection location={location} onNavClick={handleNavClick} />
                  )}
                </div>

                {/* Workspace mode toggle */}
                <div className="mt-3 pt-2 border-t border-border/40">
                  <WorkspaceModeToggle mode={workspaceMode} onChange={setWorkspaceMode} />
                </div>

                {/* AI Workforce Setup Wizard CTA */}
                <Link href="/onboarding/ai-workforce" onClick={handleNavClick}>
                  <div
                    className="mx-2 mb-2 flex items-center gap-2.5 px-3 py-2.5 rounded-md border border-violet-200/60 dark:border-violet-800/40 bg-gradient-to-r from-violet-50/80 to-purple-50/80 dark:from-violet-900/20 dark:to-purple-900/20 hover:from-violet-100 hover:to-purple-100 dark:hover:from-violet-900/30 dark:hover:to-purple-900/30 transition-colors cursor-pointer"
                    data-testid="cta-workforce-setup-wizard"
                  >
                    <div className="h-6 w-6 rounded bg-violet-100 dark:bg-violet-800/50 flex items-center justify-center flex-shrink-0">
                      <Zap className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-violet-900 dark:text-violet-200 leading-tight">AI Workforce Setup Wizard</p>
                      <p className="text-[10px] text-violet-500 dark:text-violet-400 leading-tight mt-0.5">Configure agents &amp; automation rules</p>
                    </div>
                  </div>
                </Link>
              </>
            )}

            {/* ── STAFF sections ───────────────────────────────────────────── */}
            {isStaff && (
              <div className="space-y-0.5">
                {staffSections.map((section) => (
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

            {/* ── CLIENT flat list ─────────────────────────────────────────── */}
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
                      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />}
                    </Link>
                  );
                })}
              </div>
            )}
          </SidebarContent>

          {/* ── Footer ──────────────────────────────────────────────────────── */}
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
                  onClick={() => logout(orgSlug ? `/org/${orgSlug}` : undefined)}
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </SidebarFooter>
        </Sidebar>

      </>
    </SidebarContext.Provider>
  );
}
