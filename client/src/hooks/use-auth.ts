import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import { getAuthHeaders } from "@/lib/authToken";
import { logoutAllSessions, getLogoutRedirectPath } from "@/lib/logout";

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

export function useAuth() {
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    /**
     * Log out the current user. If `redirectUrl` is provided it is used
     * directly; otherwise the best available org slug from localStorage is
     * used to redirect to `/org/:slug`, falling back to `/`.
     */
    logout: (redirectUrl?: string) =>
      logoutAllSessions(redirectUrl ?? getLogoutRedirectPath()),
    isLoggingOut: false,
  };
}
