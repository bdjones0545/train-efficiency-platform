import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Loader2, AlertCircle, RefreshCw, ArrowLeft } from "lucide-react";
import { OrgAuthModal } from "@/components/pr-tracker/OrgAuthModal";
import { CoachPrDashboard } from "@/components/pr-tracker/CoachPrDashboard";
import { AthletePrDashboard } from "@/components/pr-tracker/AthletePrDashboard";
import { useAuth } from "@/hooks/use-auth";
import { getAuthHeaders } from "@/lib/authToken";
import { Button } from "@/components/ui/button";

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

const BOOTSTRAP_TIMEOUT_MS = 15_000;

export default function PrTrackerPage({ program, orgSlug }: PrTrackerProps) {
  const orgId = program.organizationId;
  const programId = program.id;
  const programSlug = program.slug;
  const tokenKey = getTokenKey(orgId);
  const [, setLocation] = useLocation();

  // Main-app session (Replit Auth — cookie based)
  const { user: mainAppUser, isLoading: authLoading } = useAuth();

  // Org-specific session token (stored in localStorage after OrgAuthModal login)
  const [orgToken, setOrgToken] = useState<string | null>(() =>
    localStorage.getItem(tokenKey)
  );

  const [bootstrap, setBootstrap] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [bootstrapAttempted, setBootstrapAttempted] = useState(false);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  // Derived auth mode — computed each render
  // org_token     → logged in via OrgAuthModal (JWT in localStorage)
  // admin_session → logged in via main Replit app (session cookie)
  // unauthenticated → neither
  const authMode: "org_token" | "admin_session" | "unauthenticated" = orgToken
    ? "org_token"
    : mainAppUser
    ? "admin_session"
    : "unauthenticated";

  // Keep a ref so fetchBootstrap can always read the latest orgToken without
  // being listed as a dep (avoids infinite-loop edge cases on rapid token changes)
  const orgTokenRef = useRef(orgToken);
  useEffect(() => { orgTokenRef.current = orgToken; }, [orgToken]);

  const fetchBootstrap = useCallback(async () => {
    console.log("[PrTracker] bootstrap fetch start — authMode:", authMode);
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS);

    try {
      const currentToken = orgTokenRef.current;
      const headers: Record<string, string> = {
        ...getAuthHeaders(),
      };
      if (currentToken) {
        headers["X-Org-Auth-Token"] = currentToken;
      }

      const r = await fetch(
        `/api/pr-tracker/bootstrap?orgId=${orgId}&programId=${programId}`,
        { headers, credentials: "include", signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (r.status === 401) {
        if (authMode === "org_token") {
          // Expired org token — clear it; authMode → "unauthenticated" → OrgAuthModal
          localStorage.removeItem(tokenKey);
          setOrgToken(null);
        } else {
          // admin_session 401: server didn't recognize the session cookie
          setError({ message: "Session not recognized. Please refresh the page.", status: 401 });
        }
        setBootstrap(null);
        return;
      }

      let data: any;
      try {
        data = await r.json();
      } catch {
        setError({ message: "Server returned an unexpected response.", status: r.status });
        return;
      }

      if (!r.ok) {
        setError({ message: data?.message || `Request failed (${r.status})`, status: r.status });
        return;
      }

      console.log("[PrTracker] bootstrap success — authMode:", data.authMode, "canManageTeams:", data.canManageTeams);
      setBootstrap(data);
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        setError({ message: "Request timed out. Check your connection and try again." });
      } else {
        setError({ message: err.message || "Failed to load PR Tracker." });
      }
    } finally {
      setLoading(false);
      setBootstrapAttempted(true);
    }
  }, [orgId, programId, tokenKey, authMode]);

  // Fetch bootstrap whenever auth resolves and we have a valid session
  useEffect(() => {
    if (!authLoading && authMode !== "unauthenticated") {
      fetchBootstrap();
    } else if (!authLoading && authMode === "unauthenticated") {
      // Auth resolved to unauthenticated — mark attempted so we stop showing the spinner
      setBootstrapAttempted(true);
      setLoading(false);
    }
  }, [authLoading, authMode, fetchBootstrap]);

  function handleAuthenticated(token: string, _user: any, _membership: any) {
    localStorage.setItem(tokenKey, token);
    setOrgToken(token);
    setBootstrap(null);
    setBootstrapAttempted(false);
    setError(null);
  }

  function handleLogout() {
    if (authMode === "admin_session") {
      setBootstrap(null);
      setLocation(`/org/${orgSlug}/portal`);
      return;
    }
    if (orgToken) {
      fetch("/api/org-auth/logout", {
        method: "POST",
        headers: { "X-Org-Auth-Token": orgToken },
      }).catch(() => {});
    }
    localStorage.removeItem(tokenKey);
    setOrgToken(null);
    setBootstrap(null);
    setBootstrapAttempted(false);
    setError(null);
  }

  function handleRefresh() {
    if (authMode !== "unauthenticated") {
      setBootstrapAttempted(false);
      setError(null);
      fetchBootstrap();
    }
  }

  // ── Render gates — ordered so error always wins over spinner ──────────────

  // 1. Still resolving Replit Auth
  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 2. Not authenticated — show org login gate
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

  // 3. Bootstrap errored — show error card (MUST come before the spinner check)
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-4 p-8">
        <div className="flex flex-col items-center gap-3 max-w-sm text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <p className="font-medium text-sm">Failed to load PR Tracker</p>
            {error.status && (
              <p className="text-xs text-muted-foreground mt-1">Status {error.status}</p>
            )}
            <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleRefresh} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLocation(`/org/${orgSlug}/portal`)}
              className="gap-1.5"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Portal
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 4. Still loading bootstrap (or haven't attempted yet)
  if (loading || !bootstrapAttempted || !bootstrap) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading PR Tracker…</p>
      </div>
    );
  }

  // 5. Coach/admin/owner → full coach dashboard
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

  // 6. Athlete dashboard
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
