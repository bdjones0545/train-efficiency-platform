import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import { getAuthHeaders, clearAuthToken } from "@/lib/authToken";

async function fetchUser(): Promise<User | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
    headers: getAuthHeaders(),
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function getOrgSlug(): Promise<string | null> {
  try {
    const profileRes = await fetch("/api/profile", { headers: getAuthHeaders(), credentials: "include" });
    if (!profileRes.ok) return null;
    const profile = await profileRes.json();
    if (!profile?.organizationId) return null;
    const orgRes = await fetch(`/api/organizations/by-id/${profile.organizationId}`, { headers: getAuthHeaders(), credentials: "include" });
    if (!orgRes.ok) return null;
    const org = await orgRes.json();
    return org?.slug || null;
  } catch {
    return null;
  }
}

async function logout(): Promise<void> {
  const slug = await getOrgSlug();
  await fetch("/api/client/logout", {
    method: "POST",
    credentials: "include",
    headers: getAuthHeaders(),
  });
  clearAuthToken();
  window.location.href = slug ? `/org/${slug}` : "/";
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/user"], null);
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}
