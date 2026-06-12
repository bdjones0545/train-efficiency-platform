import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useCommandPaletteShortcut } from "@/hooks/use-command-palette";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Users, UsersRound, Calendar, CalendarClock, LayoutDashboard,
  DollarSign, UserCog, Trophy, Wallet, Briefcase, FileText,
  Dumbbell, Settings, Paintbrush, CreditCard, Sparkles, Bot,
  CalendarDays, ImagePlay, Target, Flame, KanbanSquare, Activity,
  Brain, Plug, GitBranch, ShieldAlert, Home, TrendingUp, Cpu,
  Building2, Radio, Clock, Zap, Send, CalendarPlus, CheckSquare,
  AlertCircle, Play, Search, Star, ArrowRight, Laptop, Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@shared/schema";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type CmdGroup = "contextual" | "actions" | "pages" | "entities" | "recent" | "ai";

type CmdEntry = {
  id: string;
  label: string;
  subtitle?: string;
  icon: React.ElementType;
  group: CmdGroup;
  tag?: string;
  keywords?: string;
  action: () => void;
  shortcut?: string;
};

type RecentCmd = { id: string; label: string; iconName: string; timestamp: number };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Recent command persistence
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const RECENT_KEY = "cmd_recent";
const MAX_RECENT = 6;

function loadRecent(): RecentCmd[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
  catch { return []; }
}

function pushRecent(entry: RecentCmd) {
  const prev = loadRecent();
  const next = [entry, ...prev.filter((r) => r.id !== entry.id)].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fuzzy match helper
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function matches(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  return h.includes(n);
}

function scoreMatch(entry: CmdEntry, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const label = entry.label.toLowerCase();
  const kw = (entry.keywords || "").toLowerCase();
  const sub = (entry.subtitle || "").toLowerCase();
  if (label.startsWith(q)) return 3;
  if (label.includes(q)) return 2;
  if (kw.includes(q) || sub.includes(q)) return 1;
  return 0;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Intent interpreter — natural language → route
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type IntentHint = { label: string; url: string; icon: React.ElementType };

function interpretIntent(query: string, role: string): IntentHint | null {
  const q = query.toLowerCase();
  const isAdmin = role === "ADMIN";
  const isCoachPlus = role === "COACH" || role === "ADMIN";

  if (/stall|stuck.?deal|no.?activity|cold.?deal/.test(q) && isAdmin)
    return { label: "View Stalled Deals", url: "/admin/team-training-deals", icon: KanbanSquare };
  if (/book|schedule.?session|new.?session|add.?session/.test(q) && isCoachPlus)
    return { label: "Book a Session", url: "/scheduling", icon: CalendarPlus };
  if (/invoice|unpaid|transaction|payment.?due/.test(q) && isCoachPlus)
    return { label: "View Transactions", url: "/coach/transactions", icon: Wallet };
  if (/follow.?up|outreach|send.?email|prospect.?email/.test(q) && isCoachPlus)
    return { label: "Open Outreach Center", url: "/coach/communications", icon: Radio };
  if (/workflow|automat|trigger/.test(q) && isAdmin)
    return { label: "Manage Workflows", url: "/admin/workflows", icon: GitBranch };
  if (/inactive|lost.?client|churned/.test(q) && isCoachPlus)
    return { label: "View Users", url: "/coach/users", icon: Users };
  if (/brain|intelligence|insights?|ai.?anal/.test(q) && isAdmin)
    return { label: "Open Business Brain", url: "/admin/business-brain", icon: Brain };
  if (/lead|prospect|outreach.?list/.test(q) && isAdmin)
    return { label: "Team Training Leads", url: "/admin/team-training-leads", icon: Target };
  if (/deal|pipeline|crm/.test(q) && isAdmin)
    return { label: "Deal Pipeline", url: "/admin/team-training-deals", icon: KanbanSquare };
  if (/approval|pending|confirm/.test(q) && isAdmin)
    return { label: "Pending Approvals", url: "/admin/agent-tools", icon: CheckSquare };
  if (/quote|team.?quote|proposal/.test(q) && isCoachPlus)
    return { label: "Create Team Quote", url: "/coach/team-quotes", icon: FileText };
  if (/command|hub|center|overview/.test(q) && isCoachPlus)
    return { label: "Command Center", url: "/command-center", icon: Flame };
  if (/availab/.test(q) && isCoachPlus)
    return { label: "Manage Availability", url: "/coach/availability", icon: CalendarClock };
  if (/health|system|ops|monitor/.test(q) && isAdmin)
    return { label: "Agent Ops Monitor", url: "/admin/agent-ops", icon: ShieldAlert };
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Contextual actions per route
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type RouteContext = { label: string; subtitle: string; icon: React.ElementType; url: string };

function getContextualActions(location: string, role: string): RouteContext[] {
  const isAdmin = role === "ADMIN";
  const isCoachPlus = role === "COACH" || role === "ADMIN";

  if (location.startsWith("/admin/team-training-deals")) {
    return [
      { label: "Filter: Stalled Deals", subtitle: "Pipeline shortcuts", icon: AlertCircle, url: "/admin/team-training-deals" },
      { label: "Send Follow-up Outreach", subtitle: "Outreach Center", icon: Send, url: "/coach/communications" },
      { label: "Create Team Quote", subtitle: "Team Quotes", icon: FileText, url: "/coach/team-quotes" },
    ];
  }
  if (location.startsWith("/admin/team-training-leads")) {
    return [
      { label: "View Deal Pipeline", subtitle: "Deals & CRM", icon: KanbanSquare, url: "/admin/team-training-deals" },
      { label: "Open Outreach Center", subtitle: "Send messages", icon: Radio, url: "/coach/communications" },
    ];
  }
  if (location.startsWith("/command-center")) {
    return isAdmin
      ? [
          { label: "Review Pending Approvals", subtitle: "Agent Tools", icon: CheckSquare, url: "/admin/agent-tools" },
          { label: "Start a Workflow", subtitle: "Workflow engine", icon: Play, url: "/admin/workflows" },
          { label: "Open Business Brain", subtitle: "AI intelligence", icon: Brain, url: "/admin/business-brain" },
        ]
      : [];
  }
  if (location.startsWith("/scheduling")) {
    return [
      { label: "Manage Availability", subtitle: "Set open slots", icon: CalendarClock, url: "/coach/availability" },
      { label: "View My Bookings", subtitle: "All bookings", icon: Calendar, url: "/bookings" },
    ];
  }
  if (location.startsWith("/coach/communications")) {
    return isAdmin
      ? [
          { label: "View Team Training Leads", subtitle: "Lead research", icon: Target, url: "/admin/team-training-leads" },
          { label: "View Stalled Deals", subtitle: "Re-engage", icon: KanbanSquare, url: "/admin/team-training-deals" },
        ]
      : [];
  }
  if (location.startsWith("/admin/agent-ops") || location.startsWith("/admin/workflows")) {
    return [
      { label: "Trigger Audit Log", subtitle: "Email agent decisions", icon: Activity, url: "/admin/trigger-audit" },
      { label: "Agent Tools", subtitle: "Pending actions", icon: Plug, url: "/admin/agent-tools" },
    ];
  }
  if (location.startsWith("/coach/users")) {
    return [
      { label: "Schedule a Session", subtitle: "Book time", icon: CalendarPlus, url: "/scheduling" },
      { label: "View Bookings", subtitle: "All sessions", icon: Calendar, url: "/bookings" },
    ];
  }
  return [];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// All pages definition (role-filtered at runtime)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type PageDef = {
  id: string; label: string; url: string; icon: React.ElementType;
  section: string; keywords?: string;
  minRole?: "CLIENT" | "STAFF" | "COACH" | "ADMIN";
  advancedOnly?: boolean;
};

const ALL_PAGES: PageDef[] = [
  { id: "command-center", label: "Command Center", url: "/command-center", icon: Flame, section: "Home", keywords: "hub daily ops", minRole: "COACH" },
  { id: "dashboard", label: "Dashboard", url: "/coach", icon: LayoutDashboard, section: "Home", keywords: "overview stats", minRole: "COACH" },
  { id: "coaches", label: "Coaches", url: "/coaches", icon: UserCog, section: "Browse", keywords: "coaches trainers" },
  { id: "group-sessions", label: "Group Sessions", url: "/sessions", icon: UsersRound, section: "Browse", keywords: "classes open sessions group" },
  { id: "team-training", label: "Team Training", url: "/team-training", icon: Dumbbell, section: "Browse", keywords: "corporate team strength" },
  { id: "my-bookings", label: "My Bookings", url: "/bookings", icon: Calendar, section: "Browse", keywords: "appointments sessions" },
  { id: "schedule", label: "Schedule", url: "/scheduling", icon: CalendarDays, section: "Scheduling", keywords: "calendar book sessions", minRole: "STAFF" },
  { id: "scheduling-agent", label: "Scheduling Agent", url: "/scheduling/agent", icon: Bot, section: "Scheduling", keywords: "AI schedule bot" },
  { id: "availability", label: "Availability", url: "/coach/availability", icon: CalendarClock, section: "Scheduling", keywords: "open hours slots", minRole: "COACH" },
  { id: "users", label: "Users", url: "/coach/users", icon: Users, section: "Clients", keywords: "clients members manage", minRole: "COACH" },
  { id: "redemptions", label: "Redemptions", url: "/coach/redemptions", icon: DollarSign, section: "Revenue", keywords: "redeem credits", minRole: "COACH" },
  { id: "transactions", label: "Transactions", url: "/coach/transactions", icon: Wallet, section: "Finance", keywords: "payments invoices money", minRole: "COACH" },
  { id: "my-profile", label: "My Profile", url: "/coach/profile", icon: UserCog, section: "Account", minRole: "COACH" },
  { id: "outreach-center", label: "Outreach Center", url: "/coach/communications", icon: Radio, section: "Growth", keywords: "email follow-up outreach prospects agent", minRole: "COACH" },
  { id: "business-plan", label: "Business Plan", url: "/coach/business-plan", icon: Briefcase, section: "Growth", keywords: "goals revenue plan", minRole: "COACH" },
  { id: "team-quotes", label: "Team Quotes", url: "/coach/team-quotes", icon: FileText, section: "Growth", keywords: "proposal quote corporate", minRole: "COACH" },
  { id: "team-training-leads", label: "Team Training Leads", url: "/admin/team-training-leads", icon: Target, section: "Growth", keywords: "leads prospects research", minRole: "ADMIN" },
  { id: "deal-pipeline", label: "Deal Pipeline", url: "/admin/team-training-deals", icon: KanbanSquare, section: "Growth", keywords: "deals CRM pipeline sales", minRole: "ADMIN" },
  { id: "business-brain", label: "Business Brain", url: "/admin/business-brain", icon: Brain, section: "AI", keywords: "intelligence analytics AI insights", minRole: "ADMIN" },
  { id: "agent-ops", label: "Agent Ops Monitor", url: "/admin/agent-ops", icon: ShieldAlert, section: "AI", keywords: "health system monitor ops", minRole: "ADMIN", advancedOnly: true },
  { id: "workflows", label: "Workflows", url: "/admin/workflows", icon: GitBranch, section: "AI", keywords: "automation trigger sequences", minRole: "ADMIN", advancedOnly: true },
  { id: "trigger-audit", label: "Trigger Audit", url: "/admin/trigger-audit", icon: Activity, section: "AI", keywords: "log decisions email agent", minRole: "ADMIN", advancedOnly: true },
  { id: "agent-tools", label: "Agent Tools", url: "/admin/agent-tools", icon: Plug, section: "AI", keywords: "tools approvals pending AI actions", minRole: "ADMIN", advancedOnly: true },
  { id: "branding", label: "Branding", url: "/admin/branding", icon: Paintbrush, section: "Organization", keywords: "logo colors design", minRole: "ADMIN" },
  { id: "media-library", label: "Media Library", url: "/admin/media", icon: ImagePlay, section: "Organization", keywords: "images videos files", minRole: "ADMIN" },
  { id: "stripe", label: "Stripe Setup", url: "/admin/stripe", icon: CreditCard, section: "Organization", keywords: "payments billing gateway", minRole: "ADMIN" },
  { id: "subscription", label: "Subscription", url: "/admin/subscription", icon: Sparkles, section: "Organization", keywords: "plan billing account", minRole: "ADMIN" },
  { id: "options", label: "Options", url: "/admin/configuration", icon: Settings, section: "Organization", keywords: "config settings preferences", minRole: "ADMIN" },
  { id: "attention-inbox", label: "Attention Inbox", url: "/admin/attention", icon: Inbox, section: "AI", keywords: "alerts inbox attention critical important notifications", minRole: "COACH" },
  { id: "wallet", label: "My Wallet", url: "/wallet", icon: Wallet, section: "Account", keywords: "credits balance", minRole: "CLIENT" },
  { id: "settings", label: "Settings", url: "/settings", icon: Settings, section: "Account", keywords: "preferences profile" },
];

const ROLE_RANK: Record<string, number> = { CLIENT: 0, STAFF: 1, COACH: 2, ADMIN: 3 };

function filterPages(role: string, workspaceMode: string): PageDef[] {
  const rank = ROLE_RANK[role] ?? 0;
  const advanced = workspaceMode === "advanced";
  return ALL_PAGES.filter((p) => {
    const minRank = ROLE_RANK[p.minRole ?? "CLIENT"] ?? 0;
    if (rank < minRank) return false;
    if (p.advancedOnly && !advanced) return false;
    return true;
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Quick actions definition
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type ActionDef = {
  id: string; label: string; subtitle: string; icon: React.ElementType;
  url: string; keywords: string;
  minRole?: "CLIENT" | "STAFF" | "COACH" | "ADMIN";
  advancedOnly?: boolean;
};

const ALL_ACTIONS: ActionDef[] = [
  { id: "book-session", label: "Book a Session", subtitle: "Navigate to schedule", icon: CalendarPlus, url: "/scheduling", keywords: "book new session schedule", minRole: "COACH" },
  { id: "send-follow-up", label: "Send Follow-up", subtitle: "Open Outreach Center", icon: Send, url: "/coach/communications", keywords: "follow up email outreach send", minRole: "COACH" },
  { id: "create-quote", label: "Create Team Quote", subtitle: "Team Quotes page", icon: FileText, url: "/coach/team-quotes", keywords: "quote proposal corporate create", minRole: "COACH" },
  { id: "view-stalled", label: "View Stalled Deals", subtitle: "Deal Pipeline", icon: AlertCircle, url: "/admin/team-training-deals", keywords: "stalled stuck deals pipeline", minRole: "ADMIN" },
  { id: "open-brain", label: "Open Business Brain", subtitle: "AI intelligence layer", icon: Brain, url: "/admin/business-brain", keywords: "brain intelligence AI insights", minRole: "ADMIN" },
  { id: "view-leads", label: "View Team Training Leads", subtitle: "Lead research", icon: Target, url: "/admin/team-training-leads", keywords: "leads prospects outreach research", minRole: "ADMIN" },
  { id: "pending-approvals", label: "Review Pending Approvals", subtitle: "Agent Tools", icon: CheckSquare, url: "/admin/agent-tools", keywords: "approvals pending review confirm", minRole: "ADMIN" },
  { id: "start-workflow", label: "Start a Workflow", subtitle: "Workflow engine", icon: Play, url: "/admin/workflows", keywords: "start workflow automation trigger", minRole: "ADMIN", advancedOnly: true },
  { id: "trigger-audit-action", label: "Check Trigger Audit", subtitle: "Email agent log", icon: Activity, url: "/admin/trigger-audit", keywords: "trigger audit log check email agent", minRole: "ADMIN", advancedOnly: true },
  { id: "command-center-action", label: "Open Command Center", subtitle: "Business hub", icon: Flame, url: "/command-center", keywords: "command hub operations center", minRole: "COACH" },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Entity search result types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type UserResult = { id: string | number; firstName?: string; lastName?: string; email?: string; role?: string };
type DealResult = { id: string | number; prospectId?: string; status?: string; proposedValue?: number };
type ProspectResult = { id: string | number; organizationName?: string; contactEmail?: string; status?: string };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Group header rendering helper
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function GroupHeading({ icon: Icon, label, className }: { icon: React.ElementType; label: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground", className)}>
      <Icon className="h-3 w-3" />
      {label}
    </div>
  );
}

function CmdRow({
  icon: Icon,
  label,
  subtitle,
  tag,
  shortcut,
  aiStyle,
  onSelect,
}: {
  icon: React.ElementType;
  label: string;
  subtitle?: string;
  tag?: string;
  shortcut?: string;
  aiStyle?: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
    >
      <span
        className={cn(
          "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border",
          aiStyle
            ? "border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
            : "border-border bg-muted/50 text-muted-foreground"
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="flex-1 min-w-0">
        <span className={cn("block text-sm font-medium truncate", aiStyle && "text-violet-700 dark:text-violet-300")}>
          {label}
        </span>
        {subtitle && (
          <span className="block text-xs text-muted-foreground truncate">{subtitle}</span>
        )}
      </span>
      {tag && (
        <span
          className={cn(
            "flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide",
            aiStyle
              ? "bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400"
              : "bg-muted text-muted-foreground"
          )}
        >
          {tag}
        </span>
      )}
      {shortcut && (
        <kbd className="flex-shrink-0 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border font-mono">
          {shortcut}
        </kbd>
      )}
      <ArrowRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/40" />
    </CommandItem>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main CommandPalette component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [recents, setRecents] = useState<RecentCmd[]>(loadRecent);
  const [, navigate] = useLocation();
  const [location] = useLocation();
  const { isAuthenticated } = useAuth();

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: isAuthenticated,
  });

  const role = profile?.role || "CLIENT";
  const workspaceMode = (() => {
    try { return (localStorage.getItem("workspace_mode") as "simplified" | "advanced") || "simplified"; }
    catch { return "simplified"; }
  })();

  // ── Debounce query for entity search ─────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // ── Reset query on close ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) setTimeout(() => setQuery(""), 150);
  }, [open]);

  // ── Register global shortcut ──────────────────────────────────────────────────
  const handleOpen = useCallback(() => setOpen(true), []);
  useCommandPaletteShortcut(handleOpen);

  // ── Entity search queries ─────────────────────────────────────────────────────
  const searchActive = debouncedQuery.length >= 2;
  const isAdmin = role === "ADMIN";
  const isCoachPlus = role === "COACH" || role === "ADMIN";

  const { data: usersRaw } = useQuery<any>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin && open && searchActive,
    staleTime: 30_000,
  });

  const { data: dealsRaw } = useQuery<any[]>({
    queryKey: ["/api/admin/team-training/deals"],
    enabled: isAdmin && open && searchActive,
    staleTime: 30_000,
  });

  const { data: prospectsRaw } = useQuery<any[]>({
    queryKey: ["/api/admin/team-training/prospects"],
    enabled: isAdmin && open && searchActive,
    staleTime: 30_000,
  });

  const { data: bookingsRaw } = useQuery<any[]>({
    queryKey: ["/api/bookings"],
    enabled: open && searchActive,
    staleTime: 30_000,
  });

  // ── Build filtered data ───────────────────────────────────────────────────────
  const pages = useMemo(() => filterPages(role, workspaceMode), [role, workspaceMode]);
  const actions = useMemo(() => {
    const rank = ROLE_RANK[role] ?? 0;
    const advanced = workspaceMode === "advanced";
    return ALL_ACTIONS.filter((a) => {
      const minRank = ROLE_RANK[a.minRole ?? "CLIENT"] ?? 0;
      if (rank < minRank) return false;
      if (a.advancedOnly && !advanced) return false;
      return true;
    });
  }, [role, workspaceMode]);

  const contextual = useMemo(() => getContextualActions(location, role), [location, role]);

  // ── Filter functions ──────────────────────────────────────────────────────────
  const q = query.toLowerCase();

  const filteredActions = useMemo(() =>
    !q ? actions.slice(0, 5) : actions
      .filter((a) => matches(`${a.label} ${a.keywords} ${a.subtitle}`, q))
      .sort((a, b) => {
        const fakeA: CmdEntry = { id: a.id, label: a.label, subtitle: a.subtitle, icon: a.icon, group: "actions", keywords: a.keywords, action: () => {} };
        const fakeB: CmdEntry = { id: b.id, label: b.label, subtitle: b.subtitle, icon: b.icon, group: "actions", keywords: b.keywords, action: () => {} };
        return scoreMatch(fakeB, query) - scoreMatch(fakeA, query);
      }),
    [actions, q, query]
  );

  const filteredPages = useMemo(() =>
    !q ? [] : pages
      .filter((p) => matches(`${p.label} ${p.keywords || ""} ${p.section}`, q))
      .sort((a, b) => {
        const scoreA = a.label.toLowerCase().startsWith(q) ? 2 : a.label.toLowerCase().includes(q) ? 1 : 0;
        const scoreB = b.label.toLowerCase().startsWith(q) ? 2 : b.label.toLowerCase().includes(q) ? 1 : 0;
        return scoreB - scoreA;
      })
      .slice(0, 8),
    [pages, q]
  );

  const filteredContextual = useMemo(() =>
    !q ? contextual : contextual.filter((c) => matches(c.label, q)),
    [contextual, q]
  );

  // Entity results
  const usersList: UserResult[] = Array.isArray(usersRaw)
    ? usersRaw
    : Array.isArray(usersRaw?.users)
    ? usersRaw.users
    : [];

  const filteredUsers = useMemo(() =>
    searchActive ? usersList.filter((u) =>
      matches(`${u.firstName || ""} ${u.lastName || ""} ${u.email || ""}`, debouncedQuery)
    ).slice(0, 4) : [],
    [usersList, debouncedQuery, searchActive]
  );

  const filteredDeals = useMemo(() =>
    searchActive && Array.isArray(dealsRaw)
      ? dealsRaw.filter((d: DealResult) => matches(`${d.status || ""} deal`, debouncedQuery)).slice(0, 3)
      : [],
    [dealsRaw, debouncedQuery, searchActive]
  );

  const filteredProspects = useMemo(() =>
    searchActive && Array.isArray(prospectsRaw)
      ? prospectsRaw.filter((p: ProspectResult) =>
          matches(`${p.organizationName || ""} ${p.contactEmail || ""}`, debouncedQuery)
        ).slice(0, 4)
      : [],
    [prospectsRaw, debouncedQuery, searchActive]
  );

  const filteredBookings = useMemo(() =>
    searchActive && Array.isArray(bookingsRaw)
      ? (bookingsRaw as any[]).filter((b: any) =>
          matches(`${b.title || ""} ${b.coachName || ""} ${b.sessionType || ""}`, debouncedQuery)
        ).slice(0, 3)
      : [],
    [bookingsRaw, debouncedQuery, searchActive]
  );

  // Intent match
  const intentHint = useMemo(
    () => (query.length >= 4 ? interpretIntent(query, role) : null),
    [query, role]
  );

  const hasResults =
    filteredContextual.length > 0 ||
    filteredActions.length > 0 ||
    filteredPages.length > 0 ||
    filteredUsers.length > 0 ||
    filteredDeals.length > 0 ||
    filteredProspects.length > 0 ||
    filteredBookings.length > 0 ||
    !!intentHint ||
    (recents.length > 0 && !q);

  // ── Navigation helper ─────────────────────────────────────────────────────────
  const go = (url: string, label: string, iconName: string) => {
    pushRecent({ id: url, label, iconName, timestamp: Date.now() });
    setRecents(loadRecent());
    setOpen(false);
    navigate(url);
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <div className="flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center border-b px-3 gap-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search pages, actions, clients..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            data-testid="input-command-search"
          />
          <kbd className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border font-mono flex-shrink-0">
            esc
          </kbd>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 pb-2">
          {!hasResults && query && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No results for <span className="font-medium">"{query}"</span>
            </div>
          )}

          {!hasResults && !query && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Search pages, clients, deals, or type an action</p>
              <p className="text-xs mt-1 opacity-60">Try: "stalled deals", "book session", "outreach"</p>
            </div>
          )}

          {/* ── Contextual actions ──────────────────────────────────────────── */}
          {filteredContextual.length > 0 && (
            <div className="pt-2">
              <GroupHeading icon={Zap} label="In context" className="text-amber-600 dark:text-amber-400" />
              {filteredContextual.map((c) => (
                <CmdRow
                  key={c.url}
                  icon={c.icon}
                  label={c.label}
                  subtitle={c.subtitle}
                  onSelect={() => go(c.url, c.label, (c.icon as React.FC).displayName || "Zap")}
                />
              ))}
            </div>
          )}

          {/* ── Intent match (AI interpretation) ───────────────────────────── */}
          {intentHint && (
            <div className={filteredContextual.length > 0 ? "border-t mt-1 pt-2" : "pt-2"}>
              <GroupHeading icon={Brain} label="AI Suggestion" className="text-violet-600 dark:text-violet-400" />
              <CmdRow
                icon={intentHint.icon}
                label={intentHint.label}
                subtitle={`Best match for "${query}"`}
                tag="AI"
                aiStyle
                onSelect={() => go(intentHint.url, intentHint.label, "Brain")}
              />
            </div>
          )}

          {/* ── Quick actions ───────────────────────────────────────────────── */}
          {filteredActions.length > 0 && (
            <div className={(filteredContextual.length > 0 || intentHint) ? "border-t mt-1 pt-2" : "pt-2"}>
              <GroupHeading icon={Zap} label={q ? "Actions" : "Quick Actions"} />
              {filteredActions.map((a) => (
                <CmdRow
                  key={a.id}
                  icon={a.icon}
                  label={a.label}
                  subtitle={a.subtitle}
                  tag={a.advancedOnly ? "Advanced" : undefined}
                  aiStyle={a.advancedOnly}
                  onSelect={() => go(a.url, a.label, (a.icon as React.FC).displayName || "Zap")}
                />
              ))}
            </div>
          )}

          {/* ── Page navigation ─────────────────────────────────────────────── */}
          {filteredPages.length > 0 && (
            <div className="border-t mt-1 pt-2">
              <GroupHeading icon={Laptop} label="Pages" />
              {filteredPages.map((p) => (
                <CmdRow
                  key={p.id}
                  icon={p.icon}
                  label={p.label}
                  subtitle={p.section}
                  tag={p.advancedOnly ? "Advanced" : undefined}
                  aiStyle={p.section === "AI"}
                  onSelect={() => go(p.url, p.label, (p.icon as React.FC).displayName || "Home")}
                />
              ))}
            </div>
          )}

          {/* ── Recent ─────────────────────────────────────────────────────── */}
          {recents.length > 0 && !q && (
            <div className="border-t mt-1 pt-2">
              <GroupHeading icon={Clock} label="Recent" />
              {recents.map((r) => {
                const page = ALL_PAGES.find((p) => p.url === r.id);
                const Icon = page?.icon || Clock;
                return (
                  <CmdRow
                    key={r.id}
                    icon={Icon}
                    label={r.label}
                    subtitle="Recently visited"
                    onSelect={() => go(r.id, r.label, r.iconName)}
                  />
                );
              })}
            </div>
          )}

          {/* ── Entity results: Users ───────────────────────────────────────── */}
          {filteredUsers.length > 0 && (
            <div className="border-t mt-1 pt-2">
              <GroupHeading icon={Users} label="Users" />
              {filteredUsers.map((u) => (
                <CmdRow
                  key={u.id}
                  icon={UserCog}
                  label={`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || "User"}
                  subtitle={u.email}
                  tag={u.role}
                  onSelect={() => go("/coach/users", "Users", "Users")}
                />
              ))}
            </div>
          )}

          {/* ── Entity results: Prospects/Leads ─────────────────────────────── */}
          {filteredProspects.length > 0 && (
            <div className="border-t mt-1 pt-2">
              <GroupHeading icon={Target} label="Leads" />
              {filteredProspects.map((p) => (
                <CmdRow
                  key={p.id}
                  icon={Target}
                  label={p.organizationName || "Lead"}
                  subtitle={p.contactEmail || p.status}
                  tag={p.status}
                  onSelect={() => go("/admin/team-training-leads", "Team Training Leads", "Target")}
                />
              ))}
            </div>
          )}

          {/* ── Entity results: Deals ───────────────────────────────────────── */}
          {filteredDeals.length > 0 && (
            <div className="border-t mt-1 pt-2">
              <GroupHeading icon={KanbanSquare} label="Deals" />
              {filteredDeals.map((d) => (
                <CmdRow
                  key={d.id}
                  icon={KanbanSquare}
                  label={`Deal ${String(d.id).slice(0, 8)}`}
                  subtitle={d.status}
                  onSelect={() => go("/admin/team-training-deals", "Deal Pipeline", "KanbanSquare")}
                />
              ))}
            </div>
          )}

          {/* ── Entity results: Bookings ────────────────────────────────────── */}
          {filteredBookings.length > 0 && (
            <div className="border-t mt-1 pt-2">
              <GroupHeading icon={Calendar} label="Bookings" />
              {filteredBookings.map((b: any) => (
                <CmdRow
                  key={b.id}
                  icon={Calendar}
                  label={b.title || b.sessionType || "Booking"}
                  subtitle={b.coachName || b.status}
                  onSelect={() => go("/bookings", "My Bookings", "Calendar")}
                />
              ))}
            </div>
          )}

          {/* ── Keyboard hint ────────────────────────────────────────────────── */}
          {hasResults && (
            <div className="border-t mt-1 pt-2 px-4 pb-1 flex items-center gap-4 text-[10px] text-muted-foreground/60">
              <span><kbd className="font-mono">↑↓</kbd> navigate</span>
              <span><kbd className="font-mono">↵</kbd> select</span>
              <span><kbd className="font-mono">esc</kbd> close</span>
            </div>
          )}
        </div>
      </div>
    </CommandDialog>
  );
}

