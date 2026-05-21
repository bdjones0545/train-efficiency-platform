import { useCallback } from "react";

interface MetaCapiOptions {
  email?: string;
  phone?: string;
  customData?: Record<string, unknown>;
}

function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function useMetaCapi() {
  const track = useCallback(
    async (eventName: string, options: MetaCapiOptions = {}) => {
      try {
        const fbp = getCookie("_fbp");
        const fbc = getCookie("_fbc");

        await fetch("/api/meta/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventName,
            eventSourceUrl: window.location.href,
            fbp,
            fbc,
            email: options.email,
            phone: options.phone,
            customData: options.customData,
          }),
        });
      } catch (err) {
        console.warn("[Meta CAPI] Failed to send event:", err);
      }
    },
    []
  );

  return { track };
}
