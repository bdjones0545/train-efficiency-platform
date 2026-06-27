const PIXEL_ID = "1017450327750475";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

const isDev = import.meta.env.DEV;

let initialized = false;

function debug(event: string, params?: Record<string, unknown>): void {
  if (!isDev) return;
  console.debug(
    `%c[MetaPixel:${PIXEL_ID}] ${event}`,
    "color:#4267B2;font-weight:bold",
    params ?? {},
  );
}

export function initPixel(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  if (!window.fbq) {
    (function (
      f: Window & typeof globalThis,
      b: Document,
      e: string,
      v: string,
    ) {
      if (f.fbq) return;
      const n = function (...args: unknown[]) {
        (n as any).callMethod
          ? (n as any).callMethod.apply(n, args)
          : (n as any).queue.push(args);
      };
      if (!f._fbq) f._fbq = n;
      (n as any).push = n;
      (n as any).loaded = true;
      (n as any).version = "2.0";
      (n as any).queue = [];
      const t = b.createElement(e) as HTMLScriptElement;
      t.async = true;
      t.src = v;
      const s = b.getElementsByTagName(e)[0];
      s.parentNode?.insertBefore(t, s);
      f.fbq = n;
    })(
      window,
      document,
      "script",
      "https://connect.facebook.net/en_US/fbevents.js",
    );
  }

  window.fbq?.("init", PIXEL_ID);
  debug("init");
}

export function trackPageView(path: string): void {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq("track", "PageView");
  debug("PageView", { path });
}

export function trackViewContent(params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq("track", "ViewContent", params ?? {});
  debug("ViewContent", params);
}

export function trackLead(params?: Record<string, unknown>, eventId?: string): void {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq("track", "Lead", params ?? {}, eventId ? { eventID: eventId } : undefined);
  debug("Lead", { ...params, eventId });
}

export function trackInitiateCheckout(params?: Record<string, unknown>, eventId?: string): void {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq("track", "InitiateCheckout", params ?? {}, eventId ? { eventID: eventId } : undefined);
  debug("InitiateCheckout", { ...params, eventId });
}

export function generateEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getMetaCookies(): { fbp?: string; fbc?: string } {
  if (typeof document === "undefined") return {};
  const map: Record<string, string> = {};
  document.cookie.split(";").forEach((c) => {
    const eq = c.indexOf("=");
    if (eq < 0) return;
    const k = c.slice(0, eq).trim();
    const v = c.slice(eq + 1).trim();
    map[k] = v;
  });
  return {
    fbp: map["_fbp"] || undefined,
    fbc: map["_fbc"] || undefined,
  };
}
