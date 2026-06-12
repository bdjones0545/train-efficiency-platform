import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ── Frontend error reporting ───────────────────────────────────────────────
function reportClientError(payload: {
  type: "onerror" | "unhandledrejection";
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  route: string;
}) {
  try {
    fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, userAgent: navigator.userAgent }),
      keepalive: true,
    }).catch(() => {/* best-effort — never throw */});
  } catch {/* never throw */}
}

window.onerror = (message, source, lineno, colno, error) => {
  reportClientError({
    type: "onerror",
    message: String(message),
    source: source ?? undefined,
    lineno: lineno ?? undefined,
    colno: colno ?? undefined,
    stack: error?.stack ?? undefined,
    route: window.location.pathname,
  });
  return false; // let default browser handling continue
};

window.onunhandledrejection = (event: PromiseRejectionEvent) => {
  const reason = event.reason;
  reportClientError({
    type: "unhandledrejection",
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack ?? undefined : undefined,
    route: window.location.pathname,
  });
};
// ──────────────────────────────────────────────────────────────────────────

createRoot(document.getElementById("root")!).render(<App />);
