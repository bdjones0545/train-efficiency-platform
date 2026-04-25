import { useQuery } from "@tanstack/react-query";
import type { Organization } from "@shared/schema";
import { getAuthHeaders } from "@/lib/authToken";

export type ActiveOrg = Omit<Organization, "stripeSecretKey"> & {
  stripeConnected: boolean;
  ownerName: string | null;
};

interface UseActiveOrgResult {
  orgId: string | null;
  org: ActiveOrg | undefined;
  isLoading: boolean;
}

export function useActiveOrg(): UseActiveOrgResult {
  const { data: profile, isLoading: profileLoading } = useQuery<{
    organizationId?: string | null;
  }>({
    queryKey: ["/api/profile"],
  });

  const orgId = profile?.organizationId ?? null;

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
  });

  return {
    orgId,
    org,
    isLoading: profileLoading || (!!orgId && orgLoading),
  };
}
