import { useQuery } from "@tanstack/react-query";
import type { Organization } from "@shared/schema";
import { getAuthHeaders } from "@/lib/authToken";

export type ActiveOrg = Omit<Organization, "stripeSecretKey"> & {
  stripeConnected: boolean;
  ownerName: string | null;
};

interface OrgContext {
  orgId: string | null;
  source: "profile" | "booking" | "subscription" | "preferences" | null;
}

interface UseActiveOrgResult {
  orgId: string | null;
  org: ActiveOrg | undefined;
  isLoading: boolean;
  source: OrgContext["source"];
}

export function useActiveOrg(): UseActiveOrgResult {
  // Single call to derive orgId from profile → bookings → prefs rows
  const { data: context, isLoading: contextLoading } = useQuery<OrgContext>({
    queryKey: ["/api/me/org-context"],
    queryFn: async () => {
      const res = await fetch("/api/me/org-context", {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to load org context");
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });

  const orgId = context?.orgId ?? null;

  const { data: org, isLoading: orgLoading } = useQuery<ActiveOrg>({
    queryKey: ["/api/organizations/by-id", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${orgId}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to load organization");
      return res.json();
    },
    enabled: !!orgId,
    staleTime: 1000 * 60 * 5,
  });

  return {
    orgId,
    org,
    isLoading: contextLoading || (!!orgId && orgLoading),
    source: context?.source ?? null,
  };
}
