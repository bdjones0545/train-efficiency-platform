import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Loader2, Trophy } from "lucide-react";
import { OrgAuthModal } from "@/components/pr-tracker/OrgAuthModal";
import { CoachPrDashboard } from "@/components/pr-tracker/CoachPrDashboard";
import { AthletePrDashboard } from "@/components/pr-tracker/AthletePrDashboard";
import { getAuthToken } from "@/lib/authToken";

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

  // Use orgToken from localStorage, or fall back to the main app auth token (coaches/admins)
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(tokenKey) || getAuthToken();
  });
  const [isCoachBypass, setIsCoachBypass] = useState(() => {
    return !localStorage.getItem(tokenKey) && !!getAuthToken();
  });
  const [bootstrap, setBootstrap] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBootstrap = useCallback(
    async (authToken: string) => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/pr-tracker/bootstrap?orgId=${orgId}&programId=${programId}`, {
          headers: { "X-Org-Auth-Token": authToken },
        });
        if (r.status === 401) {
          if (!isCoachBypass) {
            localStorage.removeItem(tokenKey);
          }
          setToken(null);
          setIsCoachBypass(false);
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
    },
    [orgId, programId, tokenKey, isCoachBypass]
  );

  useEffect(() => {
    if (token) {
      fetchBootstrap(token);
    }
  }, [token, fetchBootstrap]);

  function handleAuthenticated(newToken: string, user: any, membership: any) {
    localStorage.setItem(tokenKey, newToken);
    setToken(newToken);
    setIsCoachBypass(false);
  }

  function handleLogout() {
    if (isCoachBypass) {
      // Coach bypass users are still main-app authenticated — just navigate
      // them to the org portal instead of showing the org auth modal.
      setBootstrap(null);
      setLocation(`/org/${orgSlug}/portal`);
      return;
    }
    if (token) {
      fetch("/api/org-auth/logout", {
        method: "POST",
        headers: { "X-Org-Auth-Token": token },
      }).catch(() => {});
    }
    localStorage.removeItem(tokenKey);
    setToken(null);
    setBootstrap(null);
  }

  function handleRefresh() {
    if (token) fetchBootstrap(token);
  }

  // Not authenticated — show auth modal
  if (!token) {
    return (
      <OrgAuthModal
        orgId={orgId}
        programId={programId}
        programName={program.name}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  // Loading
  if (loading || !bootstrap) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading PR Tracker…</p>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-destructive mb-2">{error}</p>
        <button onClick={handleRefresh} className="text-xs text-primary underline">Retry</button>
      </div>
    );
  }

  const isCoach = bootstrap.membership?.role === "coach";

  if (isCoach) {
    return (
      <CoachPrDashboard
        bootstrap={bootstrap}
        orgId={orgId}
        orgSlug={orgSlug}
        programId={programId}
        programSlug={programSlug}
        programName={program.name}
        token={token}
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
      token={token}
      onRefresh={handleRefresh}
      onLogout={handleLogout}
    />
  );
}
