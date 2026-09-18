/**
 * SendGrid Inbound Parse — reply ingestion.
 *
 * This module exists so the webhook can be tested without an HTTP server and
 * without a database: every side effect goes through an injected `storage`,
 * and the environment is injected as `env`.
 *
 * Two properties this file is responsible for:
 *
 * 1. AUTHENTICATION FAILS CLOSED IN PRODUCTION.
 *    Inbound Parse can only be configured with a URL, so the shared secret has
 *    to travel in the query string. That is a weak channel, which is exactly
 *    why the secret is mandatory in production: with no secret configured the
 *    endpoint is an unauthenticated writer into every tenant's CRM. Same policy
 *    and the same timing-safe comparison as
 *    server/middleware/require-internal-service-token.ts.
 *
 * 2. A REPLY IS ATTRIBUTED BY EVIDENCE, NEVER BY "the first row that matched".
 *    Prospect contact emails are not unique across organizations — two orgs
 *    prospecting the same school hold the same athletic-director address. The
 *    only defensible attribution is the set of organizations that actually SENT
 *    outreach to this address, and each of those organizations is processed
 *    independently against its OWN prospect, draft, sequence and deal.
 */

import { createHash, timingSafeEqual } from "crypto";

export type ReplyClassification =
  import("./reply-classifier").ReplyClassification;

// ─── Storage surface ────────────────────────────────────────────────────────
// Deliberately narrow: this is the whole set of state this webhook may touch.

export interface InboundReplyStorage {
  /** Organizations that sent outreach to this address. The attribution set. */
  findOrganizationIdsWithSentOutreachToEmail(email: string): Promise<string[]>;
  /** Org-scoped prospect lookup. There is no global lookup in this module. */
  findProspectByContactEmailForOrganization(orgId: string, email: string): Promise<any | undefined>;
  getOrganizationById(id: string): Promise<any | undefined>;
  getOutreachDraftsByProspect(prospectId: string): Promise<any[]>;
  updateTeamTrainingProspect(id: string, data: any): Promise<any>;
  updateTeamTrainingOutreachDraft(id: string, data: any): Promise<any>;
  cancelFollowUpSequence(outreachDraftId: string): Promise<void>;
  getEmailMessageVariant(id: string): Promise<any>;
  updateEmailMessageVariant(id: string, data: any): Promise<any>;
  logOutreachEvent(data: any): Promise<any>;
  getTeamTrainingDealByProspect(prospectId: string, orgId: string): Promise<any>;
  createTeamTrainingDeal(data: any): Promise<any>;
}

export interface InboundReplyLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface InboundReplyDeps {
  storage: InboundReplyStorage;
  env?: NodeJS.ProcessEnv;
  classifyReply?: (text: string) => Promise<ReplyClassification | null>;
  attributeOutcome?: (
    orgId: string,
    prospectId: string,
    outcome: string,
    value: number,
    source: string,
  ) => Promise<void>;
  logger?: InboundReplyLogger;
  now?: () => Date;
}

const defaultLogger: InboundReplyLogger = {
  log: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

// ─── Authentication ─────────────────────────────────────────────────────────

export type InboundAuthDecision =
  | { ok: true; enforced: boolean }
  | { ok: false; status: number; body: { ok: false; error: string; code: string } };

function digest(value: string): Buffer {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest();
}

/** Timing-safe comparison over sha256 digests, so length never leaks. */
function safeCompare(expected: string, provided: string): boolean {
  return timingSafeEqual(digest(expected), digest(provided));
}

/**
 * Decides whether an Inbound Parse request may be processed.
 *
 * production + no secret  → 503, process nothing (fail closed).
 * secret set              → token must match, timing-safely, else 401.
 * non-production, no secret → allowed, but logged loudly.
 */
export function authorizeInboundParseRequest(
  token: unknown,
  env: NodeJS.ProcessEnv = process.env,
  logger: InboundReplyLogger = defaultLogger,
): InboundAuthDecision {
  const secret = (env.SENDGRID_INBOUND_SECRET || "").trim();
  const isProduction = env.NODE_ENV === "production";

  if (!secret) {
    if (isProduction) {
      logger.error(
        "[InboundParse] SENDGRID_INBOUND_SECRET is not set — refusing to process inbound mail in production.",
      );
      return {
        ok: false,
        status: 503,
        body: {
          ok: false,
          error: "Inbound parse endpoint unavailable",
          code: "INBOUND_SECRET_NOT_CONFIGURED",
        },
      };
    }
    logger.warn(
      "[InboundParse] SENDGRID_INBOUND_SECRET is not set — inbound mail is being accepted unauthenticated (non-production only).",
    );
    return { ok: true, enforced: false };
  }

  const provided = typeof token === "string" ? token : "";
  if (provided.length === 0 || !safeCompare(secret, provided)) {
    return {
      ok: false,
      status: 401,
      body: { ok: false, error: "Unauthorized", code: "UNAUTHORIZED" },
    };
  }

  return { ok: true, enforced: true };
}

// ─── Address extraction ─────────────────────────────────────────────────────

const ADDRESS_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function normalize(email: string): string {
  return email.toLowerCase().trim();
}

function parseEnvelope(body: any): any {
  try {
    return typeof body?.envelope === "string" ? JSON.parse(body.envelope) : body?.envelope;
  } catch {
    return undefined;
  }
}

/** Sender address: envelope JSON first (cleanest), then the From header. */
export function extractSenderEmail(body: any): string | null {
  const envelope = parseEnvelope(body);
  const fromEnvelope = typeof envelope?.from === "string" ? envelope.from : null;
  if (fromEnvelope) return normalize(fromEnvelope);

  if (typeof body?.from === "string") {
    const angled = body.from.match(/<([^>]+)>/);
    const raw = angled ? angled[1] : body.from;
    const matched = raw.match(ADDRESS_RE);
    if (matched && matched.length > 0) return normalize(matched[0]);
  }
  return null;
}

/**
 * Every address this message was delivered to — the envelope recipients plus
 * anything in the To header. These are the only per-org identity evidence the
 * webhook gets.
 */
export function extractRecipientEmails(body: any): string[] {
  const out = new Set<string>();
  const envelope = parseEnvelope(body);
  const envelopeTo = envelope?.to;
  if (Array.isArray(envelopeTo)) {
    for (const entry of envelopeTo) {
      if (typeof entry === "string") for (const m of entry.match(ADDRESS_RE) ?? []) out.add(normalize(m));
    }
  } else if (typeof envelopeTo === "string") {
    for (const m of envelopeTo.match(ADDRESS_RE) ?? []) out.add(normalize(m));
  }
  if (typeof body?.to === "string") {
    for (const m of body.to.match(ADDRESS_RE) ?? []) out.add(normalize(m));
  }
  return [...out];
}

// ─── Attribution ────────────────────────────────────────────────────────────

export interface InboundAttribution {
  orgIds: string[];
  /** "recipient-identity" when a per-org reply-to/inbox address decided it. */
  basis: "recipient-identity" | "sent-outreach" | "none";
}

/**
 * Resolves which organizations this reply belongs to.
 *
 * (a) Outbound outreach is sent with a per-org Reply-To (the org's owner email;
 *     see server/routes.ts sendTeamTrainingOutreachEmail call). If the message
 *     was delivered to a per-org identity of a candidate organization, that is
 *     direct evidence and narrows the set.
 * (b) Otherwise every organization that sent outreach to this address gets the
 *     reply, and each is processed against its own records.
 * (c) No organization ever sent to this address → nothing is attributed.
 */
export async function resolveInboundAttribution(
  senderEmail: string,
  recipients: string[],
  storage: InboundReplyStorage,
): Promise<InboundAttribution> {
  const candidates = [...new Set(await storage.findOrganizationIdsWithSentOutreachToEmail(senderEmail))];
  if (candidates.length === 0) return { orgIds: [], basis: "none" };
  if (candidates.length === 1 || recipients.length === 0) {
    return { orgIds: candidates, basis: "sent-outreach" };
  }

  const recipientSet = new Set(recipients.map(normalize));
  const identified: string[] = [];
  for (const orgId of candidates) {
    let org: any;
    try {
      org = await storage.getOrganizationById(orgId);
    } catch {
      continue;
    }
    const identities = [org?.ownerEmail, org?.schedulingInquiryEmail]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .map(normalize);
    if (identities.some((identity) => recipientSet.has(identity))) identified.push(orgId);
  }

  if (identified.length > 0) return { orgIds: identified, basis: "recipient-identity" };
  return { orgIds: candidates, basis: "sent-outreach" };
}

// ─── Per-organization processing ────────────────────────────────────────────

export interface OrgReplyResult {
  orgId: string;
  status: "processed" | "no-prospect" | "already-replied";
  prospectId?: string;
  draftId?: string;
  classification?: ReplyClassification | null;
  dealCreated?: boolean;
}

async function processReplyForOrganization(
  orgId: string,
  senderEmail: string,
  replyText: string,
  classification: ReplyClassification | null,
  deps: Required<Pick<InboundReplyDeps, "storage" | "logger" | "now">> & Pick<InboundReplyDeps, "attributeOutcome">,
): Promise<OrgReplyResult> {
  const { storage, logger, now } = deps;

  const prospect = await storage.findProspectByContactEmailForOrganization(orgId, senderEmail);
  if (!prospect) {
    logger.log(`[InboundParse] org ${orgId} has no prospect for sender ${senderEmail} — skipping this org`);
    return { orgId, status: "no-prospect" };
  }
  if (prospect.orgId && prospect.orgId !== orgId) {
    // Defence in depth: never act on a record that belongs to another tenant.
    logger.error(`[InboundParse] refusing prospect ${prospect.id} (org ${prospect.orgId}) for org ${orgId}`);
    return { orgId, status: "no-prospect" };
  }
  if (prospect.outreachStatus === "Replied") {
    logger.log(`[InboundParse] Prospect ${prospect.id} already marked replied — skipping`);
    return { orgId, status: "already-replied", prospectId: prospect.id };
  }

  await storage.updateTeamTrainingProspect(prospect.id, { outreachStatus: "Replied" });

  const drafts = await storage.getOutreachDraftsByProspect(prospect.id);
  const sentDraft = (drafts ?? []).find(
    (d: any) => !!d.sentAt && !d.repliedAt && (!d.orgId || d.orgId === orgId),
  );
  if (sentDraft) {
    await storage.updateTeamTrainingOutreachDraft(sentDraft.id, {
      repliedAt: now(),
      replyText: replyText || null,
      replyClassification: classification,
    });
    await storage.cancelFollowUpSequence(sentDraft.id);
    if (sentDraft.messageVariantId) {
      try {
        const variant = await storage.getEmailMessageVariant(sentDraft.messageVariantId);
        if (variant) {
          await storage.updateEmailMessageVariant(variant.id, {
            replies: (variant.replies ?? 0) + 1,
            conversions: (variant.conversions ?? 0) + 1,
          });
        }
      } catch {}
    }
  }

  await storage.logOutreachEvent({
    orgId,
    prospectId: prospect.id,
    eventType: "replied",
    description: classification
      ? `Auto-detected inbound reply (${classification})`
      : "Auto-detected inbound reply via SendGrid",
    metadata: {
      replyText: replyText.slice(0, 500) || null,
      classification,
      source: "sendgrid_inbound",
    },
  });

  if (deps.attributeOutcome) {
    try {
      await deps.attributeOutcome(orgId, prospect.id, "engaged", 0, "reply");
    } catch {}
  }

  let dealCreated = false;
  if (classification === "interested" || classification === "ask_info") {
    const existingDeal = await storage.getTeamTrainingDealByProspect(prospect.id, orgId);
    if (!existingDeal) {
      await storage.createTeamTrainingDeal({
        organizationId: orgId,
        prospectId: prospect.id,
        outreachDraftId: sentDraft?.id ?? null,
        status: "interested",
        estimatedValue: prospect.estimatedValue ?? 0,
        probability: 40,
        nextAction:
          classification === "ask_info"
            ? "Send information and schedule a call"
            : "Schedule a discovery call",
        notes: replyText ? `Auto-detected reply: ${replyText.slice(0, 300)}` : "",
        lastActivityAt: now(),
      });
      dealCreated = true;
    }
  }

  logger.log(
    `[InboundParse] Reply processed — org: ${orgId}, prospect: ${prospect.prospectName} (${prospect.id}), classification: ${classification}`,
  );
  return {
    orgId,
    status: "processed",
    prospectId: prospect.id,
    draftId: sentDraft?.id,
    classification,
    dealCreated,
  };
}

// ─── Entry points ───────────────────────────────────────────────────────────

export interface InboundReplyOutcome {
  status: "no-sender" | "unattributed" | "processed";
  senderEmail?: string;
  basis?: InboundAttribution["basis"];
  results: OrgReplyResult[];
}

async function defaultClassifyReply(text: string): Promise<ReplyClassification | null> {
  try {
    const { classifyReply } = await import("./reply-classifier");
    return await classifyReply(text);
  } catch {
    return null;
  }
}

async function defaultAttributeOutcome(
  orgId: string,
  prospectId: string,
  outcome: string,
  value: number,
  source: string,
): Promise<void> {
  const { attributeOutcomeToProspect } = await import("./revenue-outcome-engine");
  await attributeOutcomeToProspect(
    orgId,
    prospectId,
    outcome as "engaged" | "booked" | "won" | "lost",
    value,
    source,
  );
}

/**
 * Processes one Inbound Parse payload. Assumes the request has already been
 * authorized by authorizeInboundParseRequest.
 */
export async function processInboundReply(
  body: any,
  deps: InboundReplyDeps,
): Promise<InboundReplyOutcome> {
  const logger = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());
  const storage = deps.storage;

  const senderEmail = extractSenderEmail(body);
  if (!senderEmail) {
    logger.log("[InboundParse] Could not extract sender email — skipping");
    return { status: "no-sender", results: [] };
  }

  const replyText = ((body?.text as string) || "").slice(0, 2000);
  const recipients = extractRecipientEmails(body);

  const attribution = await resolveInboundAttribution(senderEmail, recipients, storage);
  if (attribution.orgIds.length === 0) {
    // No organization ever sent outreach to this address. There is no
    // unmatched-inbound table in this schema, so the message is logged and
    // dropped — never guessed onto a tenant.
    logger.warn(
      `[InboundParse] Unattributable inbound reply from ${senderEmail} (recipients: ${recipients.join(", ") || "unknown"}) — no organization has sent outreach to this address. No records changed.`,
    );
    return { status: "unattributed", senderEmail, basis: "none", results: [] };
  }

  let classification: ReplyClassification | null = null;
  if (replyText) {
    try {
      classification = await (deps.classifyReply ?? defaultClassifyReply)(replyText);
    } catch {
      classification = null;
    }
  }

  const results: OrgReplyResult[] = [];
  for (const orgId of attribution.orgIds) {
    try {
      results.push(
        await processReplyForOrganization(orgId, senderEmail, replyText, classification, {
          storage,
          logger,
          now,
          attributeOutcome: deps.attributeOutcome ?? defaultAttributeOutcome,
        }),
      );
    } catch (err: any) {
      // One organization's failure must never block the others.
      logger.error(`[InboundParse] Error processing reply for org ${orgId}: ${err?.message}`);
    }
  }

  return { status: "processed", senderEmail, basis: attribution.basis, results };
}

/**
 * Express handler. Authorizes first, answers SendGrid immediately so it does
 * not retry, then processes. Returns once processing has settled, which is what
 * makes it directly testable.
 */
export function createSendGridInboundHandler(deps: InboundReplyDeps) {
  return async function sendGridInboundHandler(req: any, res: any): Promise<void> {
    const logger = deps.logger ?? defaultLogger;
    const env = deps.env ?? process.env;

    const decision = authorizeInboundParseRequest(req?.query?.token, env, logger);
    if (!decision.ok) {
      res.status(decision.status).json(decision.body);
      return;
    }

    res.status(200).json({ ok: true });

    try {
      await processInboundReply(req?.body ?? {}, deps);
    } catch (err: any) {
      logger.error(`[InboundParse] Error processing inbound email: ${err?.message}`);
    }
  };
}
