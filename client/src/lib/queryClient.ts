import { QueryClient, QueryCache, QueryFunction } from "@tanstack/react-query";
import { getAuthHeaders } from "./authToken";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
    ...(extraHeaders ?? {}),
  };
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: {
        ...getAuthHeaders(),
        "Cache-Control": "no-cache",
      },
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

const PUBLIC_PATH_PREFIXES = [
  "/apply/",
  "/org/",
  "/attendance/",
  "/unsubscribe/",
  "/subscribe/",
];
const PUBLIC_PATHS_EXACT = new Set([
  "/",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/create-password",
  "/signup",
  "/privacy",
  "/terms",
  "/efficiencystrength",
]);

function isPublicRoute(path: string): boolean {
  if (PUBLIC_PATHS_EXACT.has(path)) return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError(error: unknown, query) {
      const msg = error instanceof Error ? error.message : String(error);
      const path = window.location.pathname;
      const statusMatch = msg.match(/^(\d{3}):/);
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : null;
      const queryKey = Array.isArray(query.queryKey)
        ? query.queryKey.join(" / ")
        : String(query.queryKey);

      // Always log query errors for observability
      console.error("[QueryCache] Query failed", {
        queryKey,
        route: path,
        statusCode,
        message: msg,
      });

      // Persist to reliability DB (fire-and-forget — never throw)
      fetch("/api/reliability/query-failures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route: path, queryKey, statusCode, message: msg }),
        keepalive: true,
      }).catch(() => {});

      // 401: redirect unauthenticated users home — but ONLY when the auth cache
      // confirms the user is truly logged out.  Firing window.location.href on
      // every 401 (including permission-level errors on protected pages) causes
      // authenticated users to be booted, especially on mobile Safari where the
      // session cookie may not arrive until after the first page-data query fires.
      //
      //   undefined → auth query hasn't settled yet — let it resolve, do nothing
      //   null      → user is confirmed not authenticated — redirect is correct
      //   object    → user IS authenticated; this 401 is a permission/scope error,
      //               not a missing session — suppress the redirect
      if (statusCode === 401) {
        if (!isPublicRoute(path)) {
          const cachedUser = queryClient.getQueryData(["/api/auth/user"]);
          if (cachedUser === null) {
            console.warn("[QueryCache] 401 + auth cache is null — redirecting to home from:", path);
            window.location.href = "/";
          } else {
            console.warn(
              "[QueryCache] 401 on data query (auth cache:",
              cachedUser === undefined ? "pending" : "authenticated",
              ") — suppressing home redirect for:",
              queryKey,
            );
          }
        }
      }
    },
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
