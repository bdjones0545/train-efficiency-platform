import { clearAuthToken, getAuthHeaders } from "./authToken";
import { queryClient } from "./queryClient";

function getAllOrgTokenKeys(): string[] {
  return Object.keys(localStorage).filter(
    (k) =>
      k.startsWith("orgToken_") ||
      k === "selectedOrgId" ||
      k === "orgMembership" ||
      k === "orgSession" ||
      k === "workspaceMode"
  );
}

function getSessionStorageAuthKeys(): string[] {
  return Object.keys(sessionStorage).filter(
    (k) =>
      k.startsWith("orgToken_") ||
      k.startsWith("auth_") ||
      k === "selectedOrgId"
  );
}

/**
 * Fully logs out the current user from both the main platform auth and all
 * org-specific sessions, then redirects to `redirectUrl` (default: "/").
 *
 * Clears:
 *  - Main platform auth token (localStorage + backend DB row)
 *  - All orgToken_* keys and related org state from localStorage
 *  - Auth-related sessionStorage entries
 *  - The full React Query cache
 *  - Server-side Passport session + session cookie
 */
export async function logoutAllSessions(redirectUrl = "/"): Promise<void> {
  if (import.meta.env.DEV) {
    const lsKeys = [
      ...getAllOrgTokenKeys(),
      ...(localStorage.getItem("auth_token") ? ["auth_token"] : []),
    ];
    const ssKeys = getSessionStorageAuthKeys();
    console.log("[logout] Before logout — localStorage keys to clear:", lsKeys);
    console.log("[logout] Before logout — sessionStorage keys to clear:", ssKeys);
  }

  // 1. Call backend logout first while the token is still available
  try {
    await fetch("/api/client/logout", {
      method: "POST",
      credentials: "include",
      headers: getAuthHeaders(),
    });
  } catch {
    // Network errors during logout are non-fatal — continue clearing locally
  }

  // 2. Clear main platform auth token from localStorage
  clearAuthToken();

  // 3. Clear all org tokens + related state from localStorage
  getAllOrgTokenKeys().forEach((k) => localStorage.removeItem(k));

  // 4. Clear auth-related keys from sessionStorage
  getSessionStorageAuthKeys().forEach((k) => sessionStorage.removeItem(k));

  // 5. Wipe the entire React Query cache so no auth/org/permissions data
  //    lingers in memory or gets re-hydrated on the next render
  queryClient.clear();

  if (import.meta.env.DEV) {
    const remaining = [
      ...Object.keys(localStorage).filter(
        (k) => k.startsWith("orgToken_") || k === "auth_token"
      ),
      ...Object.keys(sessionStorage).filter(
        (k) => k.startsWith("orgToken_") || k.startsWith("auth_")
      ),
    ];
    console.log(
      "[logout] After logout — remaining auth keys:",
      remaining.length === 0 ? "none (clean)" : remaining
    );
  }

  // 6. Hard-navigate so in-memory React state is fully discarded
  window.location.href = redirectUrl;
}
