import type { Express, Request, Response } from "express";
import crypto from "crypto";

const PIXEL_ID = "1707062324050326";
const CAPI_URL = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events`;

function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

interface CapiEventPayload {
  eventName: string;
  eventSourceUrl?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbp?: string;
  fbc?: string;
  email?: string;
  phone?: string;
  customData?: Record<string, unknown>;
}

async function sendCapiEvent(payload: CapiEventPayload): Promise<void> {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) {
    console.warn("[Meta CAPI] META_CAPI_TOKEN not set — skipping event.");
    return;
  }

  const userData: Record<string, unknown> = {};

  if (payload.clientIpAddress) userData.client_ip_address = payload.clientIpAddress;
  if (payload.clientUserAgent) userData.client_user_agent = payload.clientUserAgent;
  if (payload.fbp) userData.fbp = payload.fbp;
  if (payload.fbc) userData.fbc = payload.fbc;
  if (payload.email) userData.em = hashValue(payload.email);
  if (payload.phone) userData.ph = hashValue(payload.phone);

  const event: Record<string, unknown> = {
    event_name: payload.eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: "website",
    event_source_url: payload.eventSourceUrl ?? "",
    user_data: userData,
  };

  if (payload.customData && Object.keys(payload.customData).length > 0) {
    event.custom_data = payload.customData;
  }

  const body = JSON.stringify({
    data: [event],
  });

  const res = await fetch(`${CAPI_URL}?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[Meta CAPI] Error sending event "${payload.eventName}": ${res.status} ${text}`);
  } else {
    console.log(`[Meta CAPI] Event "${payload.eventName}" sent successfully.`);
  }
}

export function registerMetaCapiRoutes(app: Express): void {
  app.post("/api/meta/event", async (req: Request, res: Response) => {
    try {
      const {
        eventName,
        eventSourceUrl,
        fbp,
        fbc,
        email,
        phone,
        customData,
      } = req.body;

      if (!eventName || typeof eventName !== "string") {
        return res.status(400).json({ error: "eventName is required" });
      }

      const clientIpAddress =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket.remoteAddress ||
        "";

      const clientUserAgent = req.headers["user-agent"] || "";

      await sendCapiEvent({
        eventName,
        eventSourceUrl,
        clientIpAddress,
        clientUserAgent,
        fbp,
        fbc,
        email,
        phone,
        customData,
      });

      return res.json({ success: true });
    } catch (err) {
      console.error("[Meta CAPI] Unexpected error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
}

export { sendCapiEvent };
