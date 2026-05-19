import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { OrgAuthModal } from "@/components/pr-tracker/OrgAuthModal";
import { CoachPrDashboard } from "@/components/pr-tracker/CoachPrDashboard";
import { AthletePrDashboard } from "@/components/pr-tracker/AthletePrDashboard";
import { useAuth } from "@/hooks/use-auth";

interface PrTrackerProps {
  program: {
    id: string;
    organizationId: string;
    name: string;
    slug: string;
    type: string;
  };
  orgSlug: string;
}

function getTokenKey(orgId: string) {
  return `orgToken_${orgId}`;
}

export default function PrTrackerPage({ program, orgSlug }: PrTrackerProps) {
  const orgId = program.organizationId;
  const programId = program.id;
  const programSlug = program.slug;
  const tokenKey = getTokenKey(orgId);
  const [, setLocation] = useLocation();

  // Main-app session (Replit Auth — cookie based, no localStorage token needed)
  const { user: mainAppUser, isLoading: authLoading } = useAuth();

  // Org-specific session token (stored in localStorage after OrgAuthModal login)
  const [orgToken, setOrgToken] = useState<string | null>(() =>
    localStorage.getItem(tokenKey)
  );

  const [bootstrap, setBootstrap] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived auth mode — no useState needed, computed each render
  // org_token   → logged in via OrgAuthModal (stored JWT in localStorage)
  // admin_session → logged in via main Replit app (session cookie)
  // unauthenticated → neither
  const authMode: "org_token" | "admin_session" | "unauthenticated" = orgToken
    ? "org_token"
    : mainAppUser
    ? "admin_session"
    : "unauthenticated";

  const fetchBootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (authMode === "org_token" && orgToken) {
        headers["X-Org-Auth-Token"] = orgToken;
      }
      // For admin_session: no token header — server reads req.user from session cookie

      const r = await fetch(
        `/api/pr-tracker/bootstrap?orgId=${orgId}&programId=${programId}`,
        { headers, credentials: "include" }
      );

      if (r.status === 401) {
        // Org token expired — clear it and fall back to auth gate
        if (authMode === "org_token") {
          localStorage.removeItem(tokenKey);
          setOrgToken(null);
        }
        setBootstrap(null);
        return;
      }

      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Failed to load");
      setBootstrap(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [orgId, programId, tokenKey, authMode, orgToken]);

  // Fetch bootstrap whenever auth mode resolves to something valid
  useEffect(() => {
    if (!authLoading && authMode !== "unauthenticated") {
      fetchBootstrap();
    }
  }, [authLoading, authMode, fetchBootstrap]);

  function handleAuthenticated(token: string, _user: any, _membership: any) {
    localStorage.setItem(tokenKey, token);
    setOrgToken(token);
    setBootstrap(null); // trigger re-fetch via authMode change
  }

  function handleLogout() {
    if (authMode === "admin_session") {
      // Main-app users stay logged in — just navigate them to the org portal
      setBootstrap(null);
      setLocation(`/org/${orgSlug}/portal`);
      return;
    }
    // Org-token users: call logout API and clear token
    if (orgToken) {
      fetch("/api/org-auth/logout", {
        method: "POST",
        headers: { "X-Org-Auth-Token": orgToken },
      }).catch(() => {});
    }
    localStorage.removeItem(tokenKey);
    setOrgToken(null);
    setBootstrap(null);
  }

  function handleRefresh() {
    if (authMode !== "unauthenticated") fetchBootstrap();
  }

  // Still figuring out auth state
  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not authenticated — show org login gate
  if (authMode === "unauthenticated") {
    return (
      <OrgAuthModal
        orgId={orgId}
        programId={programId}
        programName={program.name}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  // Loading bootstrap data
  if (loading || !bootstrap) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading PR Tracker…</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-destructive mb-2">{error}</p>
        <button onClick={handleRefresh} className="text-xs text-primary underline">
          Retry
        </button>
      </div>
    );
  }

  // Coach/admin/owner → full coach dashboard
  const isCoach = bootstrap.canManageTeams === true;

  if (isCoach) {
    return (
      <CoachPrDashboard
        bootstrap={bootstrap}
        orgId={orgId}
        orgSlug={orgSlug}
        programId={programId}
        programSlug={programSlug}
        programName={program.name}
        token={orgToken ?? ""}
        onRefresh={handleRefresh}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <AthletePrDashboard
      bootstrap={bootstrap}
      orgId={orgId}
      orgSlug={orgSlug}
      programId={programId}
      programSlug={programSlug}
      programName={program.name}
      token={orgToken ?? ""}
      onRefresh={handleRefresh}
      onLogout={handleLogout}
    />
  );
}
