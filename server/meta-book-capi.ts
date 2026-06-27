import crypto from "crypto";

const PIXEL_ID = process.env.META_BOOK_PIXEL_ID ?? "1017450327750475";
const CAPI_URL = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events`;

const ALLOWED_EVENTS = new Set(["ViewContent", "Lead", "InitiateCheckout"]);

const isDev = process.env.NODE_ENV !== "production";

function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// In-process dedup: prevents double-sends within the same server process.
// Meta's own event_id deduplication handles browser-vs-CAPI dedup.
const sentKeys = new Set<string>();

function markSent(key: string): boolean {
  if (sentKeys.has(key)) return false;
  sentKeys.add(key);
  setTimeout(() => sentKeys.delete(key), 5 * 60 * 1000);
  return true;
}

export interface BookCapiPayload {
  eventName: string;
  eventId: string;
  email?: string;
  eventSourceUrl?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbp?: string;
  fbc?: string;
  customData?: Record<string, unknown>;
}

export interface BookCapiResult {
  sent: boolean;
  reason?: string;
}

export async function sendBookCapiEvent(payload: BookCapiPayload): Promise<BookCapiResult> {
  const token = process.env.META_BOOK_ACCESS_TOKEN;

  if (!token || !PIXEL_ID) {
    if (isDev) {
      console.debug(`[MetaBookCAPI] skipped because secrets missing (event=${payload.eventName})`);
    }
    return { sent: false, reason: "secrets_missing" };
  }

  if (!ALLOWED_EVENTS.has(payload.eventName)) {
    console.warn(`[MetaBookCAPI] Blocked: "${payload.eventName}" is not an allowed event for the book funnel`);
    return { sent: false, reason: "event_not_allowed" };
  }

  const dedupeKey = `${payload.eventName}:${payload.eventId}`;
  if (!markSent(dedupeKey)) {
    if (isDev) {
      console.debug(`[MetaBookCAPI] Duplicate skipped — already sent (${dedupeKey})`);
    }
    return { sent: false, reason: "duplicate" };
  }

  const userData: Record<string, unknown> = {};
  if (payload.clientIpAddress) userData.client_ip_address = payload.clientIpAddress;
  if (payload.clientUserAgent) userData.client_user_agent = payload.clientUserAgent;
  if (payload.fbp) userData.fbp = payload.fbp;
  if (payload.fbc) userData.fbc = payload.fbc;
  if (payload.email) userData.em = hashValue(payload.email);

  const event: Record<string, unknown> = {
    event_name: payload.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: payload.eventId,
    action_source: "website",
    event_source_url: payload.eventSourceUrl ?? "https://trainingefficiency.com/book",
    user_data: userData,
  };
  if (payload.customData && Object.keys(payload.customData).length > 0) {
    event.custom_data = payload.customData;
  }

  try {
    const res = await fetch(`${CAPI_URL}?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event] }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[MetaBookCAPI] Error sending "${payload.eventName}": ${res.status} ${text}`);
      return { sent: false, reason: `http_${res.status}` };
    }

    if (isDev) {
      console.debug(`[MetaBookCAPI] ${payload.eventName} sent (eventId=${payload.eventId})`);
    } else {
      console.log(`[MetaBookCAPI] ${payload.eventName} sent`);
    }
    return { sent: true };
  } catch (err: any) {
    console.error(`[MetaBookCAPI] Network error sending "${payload.eventName}":`, err?.message ?? err);
    return { sent: false, reason: err?.message ?? "network_error" };
  }
}
