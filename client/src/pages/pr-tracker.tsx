import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Loader2, AlertCircle, RefreshCw, ArrowLeft } from "lucide-react";
import { OrgAuthModal } from "@/components/pr-tracker/OrgAuthModal";
import { CoachPrDashboard } from "@/components/pr-tracker/CoachPrDashboard";
import { AthletePrDashboard } from "@/components/pr-tracker/AthletePrDashboard";
import { getAuthHeaders, setAuthToken } from "@/lib/authToken";
import { logoutAllSessions } from "@/lib/logout";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/use-permissions";

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
  const { hasAccess, isHydrating } = usePermissions(orgSlug);

  const [orgToken, setOrgToken] = useState<string | null>(() =>
    localStorage.getItem(tokenKey)
  );
  const [bootstrap, setBootstrap] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapAttempted, setBootstrapAttempted] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const orgTokenRef = useRef(orgToken);
  useEffect(() => { orgTokenRef.current = orgToken; }, [orgToken]);

  const fetchBootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    setShowAuthModal(false);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS);

    try {
      const currentToken = orgTokenRef.current;
      const headers: Record<string, string> = { ...getAuthHeaders() };
      if (currentToken) headers["X-Org-Auth-Token"] = currentToken;

      const r = await fetch(
        `/api/pr-tracker/bootstrap?orgId=${orgId}&programId=${programId}`,
        { headers, credentials: "include", signal: controller.signal }
      );
      clearTimeout(timeoutId);

      if (r.status === 401) {
        // If the user has a valid platform session + org membership, skip the modal
        if (hasAccess) {
          console.warn("[AUTH DRIFT DETECTED]", {
            page: "pr-tracker",
            orgSlug,
            hasAccess,
            isHydrating,
            orgTokenPresent: !!orgTokenRef.current,
          });
          setError({ message: "Session expired. Please refresh the page.", status: 401 });
          return;
        }
        // No main session — clear any stale org token and show the login modal
        if (orgTokenRef.current) {
          localStorage.removeItem(tokenKey);
          setOrgToken(null);
        }
        setBootstrap(null);
        setShowAuthModal(true);
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
  }, [orgId, programId, tokenKey]);

  // Delay the initial fetch until permissions are resolved so hasAccess is accurate
  useEffect(() => {
    if (!isHydrating) {
      fetchBootstrap();
    }
  }, [isHydrating]);

  function handleAuthenticated(token: string, _user: any, _membership: any, mainAppToken?: string) {
    // If the login also returned a main-app token, store it so the user is
    // fully logged in across the entire app (unified auth)
    if (mainAppToken) {
      setAuthToken(mainAppToken);
    }
    localStorage.setItem(tokenKey, token);
    setOrgToken(token);
    setShowAuthModal(false);
    setBootstrap(null);
    setBootstrapAttempted(false);
    setError(null);
    fetchBootstrap();
  }

  function handleLogout() {
    logoutAllSessions(`/org/${orgSlug}/portal`);
  }

  function handleRefresh() {
    setBootstrapAttempted(false);
    setError(null);
    fetchBootstrap();
  }

  // ── Render gates ─────────────────────────────────────────────────────────

  // 0. While permissions are resolving, show a neutral spinner
  if (isHydrating) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // 1. Show org login gate only when the server says 401 AND the user has no main session
  if (showAuthModal && !hasAccess) {
    return (
      <OrgAuthModal
        orgId={orgId}
        programId={programId}
        programName={program.name}
        onAuthenticated={handleAuthenticated}
        onClose={() => setLocation(`/org/${orgSlug}`)}
      />
    );
  }

  // 2. Bootstrap errored
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

  // 3. Loading
  if (loading || !bootstrapAttempted || !bootstrap) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading PR Tracker…</p>
      </div>
    );
  }

  // 4. Any coach type (full org coach or team_coach) → coach dashboard
  const isCoach = bootstrap.canManageAllTeams === true || bootstrap.canManageOwnTeams === true;

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

  // 5. Athlete dashboard
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
