const PIXEL_ID = "1017450327750475";

declare global {
  interface Window {
    fbq: (...args: unknown[]) => void;
    _fbq: unknown;
  }
}

let initialized = false;
let lastTrackedPath = "";

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

  window.fbq("init", PIXEL_ID);
}

export function trackPageView(path?: string): void {
  if (typeof window === "undefined" || !window.fbq) return;
  const currentPath = path ?? window.location.pathname;
  if (currentPath === lastTrackedPath) return;
  lastTrackedPath = currentPath;
  window.fbq("track", "PageView");
}

export function trackViewContent(params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq("track", "ViewContent", params ?? {});
}

export function trackLead(params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq("track", "Lead", params ?? {});
}

export function trackInitiateCheckout(params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq("track", "InitiateCheckout", params ?? {});
}
