import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getAuthHeaders } from "@/lib/authToken";
import { fetchJson } from "@/lib/api-helpers";
import type { UserProfile } from "@shared/schema";

// ─── Workspace Roles ─────────────────────────────────────────────────────────

export type WorkspaceRole = "owner" | "admin" | "coach" | "staff" | "athlete" | "guest";

// ─── Permission Flags ────────────────────────────────────────────────────────

export interface WorkspacePermissions {
  isLoading: boolean;
  /** True while permissions are still resolving — prevents flash of access-denied screens. */
  isHydrating: boolean;
  role: WorkspaceRole;

  /** True when the user has at least coach/staff-level org access. Use this to gate org management pages. */
  hasAccess: boolean;

  canAccessCommandCenter: boolean;
  canManageAthletes: boolean;
  canManageScheduling: boolean;
  canViewRevenue: boolean;
  canManageWorkflows: boolean;
  canManageAI: boolean;
  canManageOrganization: boolean;
  canViewAnalytics: boolean;
  canManageBilling: boolean;
}

// ─── Role derivation ─────────────────────────────────────────────────────────

function deriveWorkspaceRole(
  platformRole: string | null | undefined,
  orgEffectiveRole: string | null | undefined
): WorkspaceRole {
  // Org-specific role takes precedence when inside an org context
  if (orgEffectiveRole) {
    const r = orgEffectiveRole.toLowerCase();
    if (r === "owner") return "owner";
    if (r === "admin") return "admin";
    if (r === "coach") return "coach";
    if (r === "team_coach") return "coach";
    if (r === "staff") return "staff";
    if (r === "athlete") return "athlete";
  }

  // Fall back to platform role
  switch (platformRole) {
    case "ADMIN": return "admin";
    case "COACH": return "coach";
    case "STAFF": return "staff";
    case "CLIENT": return "athlete";
    default: return "guest";
  }
}

function buildPermissions(role: WorkspaceRole, isLoading: boolean): WorkspacePermissions {
  const isOwner = role === "owner";
  const isAdmin = role === "admin" || isOwner;
  const isCoach = role === "coach" || isAdmin;
  const isStaff = role === "staff" || isCoach;

  return {
    isLoading,
    // isHydrating mirrors isLoading so pages can guard against flash of access-denied screens
    isHydrating: isLoading,
    role,

    // hasAccess = any coach/staff/admin/owner level — the primary gate for org management pages
    hasAccess: isStaff,

    // Owners/admins/coaches/staff can access the command center
    canAccessCommandCenter: isStaff,

    // Owners/admins/coaches can manage athletes
    canManageAthletes: isCoach,

    // Everyone with staff+ can manage scheduling
    canManageScheduling: isStaff,

    // Owners/admins/coaches can see revenue
    canViewRevenue: isCoach,

    // Owners/admins can manage workflows
    canManageWorkflows: isAdmin,

    // Owners/admins can manage AI
    canManageAI: isAdmin,

    // Owners/admins can manage organization settings
    canManageOrganization: isAdmin,

    // Owners/admins/coaches can view analytics
    canViewAnalytics: isCoach,

    // Only owners/admins can manage billing
    canManageBilling: isAdmin,
  };
}

// ─── Main hook ───────────────────────────────────────────────────────────────

/**
 * usePermissions() — centralized permission system.
 *
 * When called inside an org context (pass orgSlug), the hook fetches
 * the nav-context to resolve the org-specific effectiveRole which takes
 * precedence over the platform role.
 *
 * Admins and owners automatically inherit all coach permissions.
 */
export function usePermissions(orgSlug?: string): WorkspacePermissions {
  const { user, isLoading: authLoading } = useAuth();
  const isAuthenticated = !!user;

  const { data: profile, isLoading: profileLoading } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: isAuthenticated,
  });

  const { data: navCtx, isLoading: navLoading } = useQuery<{
    effectiveRole: string | null;
    isAuthenticated: boolean;
  }>({
    queryKey: [`/api/org/by-slug/${orgSlug}/nav-context`],
    queryFn: () => fetchJson(`/api/org/by-slug/${orgSlug}/nav-context`, { headers: getAuthHeaders() }),
    enabled: !!orgSlug,
    staleTime: 30_000,
  });

  const isLoading = authLoading || profileLoading || (!!orgSlug && navLoading);

  // During hydration, return a neutral loading state that doesn't
  // flash an access-denied screen
  if (isLoading) {
    return buildPermissions("guest", true);
  }

  const role = deriveWorkspaceRole(profile?.role, orgSlug ? navCtx?.effectiveRole : undefined);
  return buildPermissions(role, false);
}
