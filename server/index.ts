import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrations } from 'stripe-replit-sync';
import { getStripeSync } from './stripeClient';
import { WebhookHandlers } from './webhookHandlers';
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { validateEmailProvider } from "./email";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL not set, skipping Stripe init');
    return;
  }

  try {
    console.log('Initializing Stripe schema...');
    await runMigrations({ databaseUrl } as any);
    console.log('Stripe schema ready');

    const stripeSync = await getStripeSync();

    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    const webhookResult = await stripeSync.findOrCreateManagedWebhook(
      `${webhookBaseUrl}/api/stripe/webhook`
    );
    console.log('Webhook configured:', webhookResult?.webhook?.url || webhookResult?.url || 'OK');

    stripeSync.syncBackfill()
      .then(() => console.log('Stripe data synced'))
      .catch((err: any) => console.error('Error syncing Stripe data:', err));
  } catch (error) {
    console.error('Failed to initialize Stripe:', error);
  }
}

(async () => { await initStripe(); })();

// Validate email provider at startup — surface misconfiguration in logs immediately
(async () => {
  const result = await validateEmailProvider();
  if (result.ok) {
    console.log(`[Email] SendGrid configured — from: ${result.fromEmail}`);
  } else {
    console.warn(`[Email] SendGrid NOT configured: ${result.error}`);
  }
})();

app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature' });
    }

    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;

      if (!Buffer.isBuffer(req.body)) {
        console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer');
        return res.status(500).json({ error: 'Webhook processing error' });
      }

      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error('Webhook error:', error.message);
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const { seedDatabase } = await import("./seed");
  await seedDatabase();

  const { seedDefaultEducationLibrary } = await import("./education-seed");
  await seedDefaultEducationLibrary();

  const { detectOutcomesForOrg, executeAutoActions, runCampaignEngine } = await import("./action-tracking");
  const { db: actionDb } = await import("./db");
  const { organizations: orgsTable } = await import("@shared/schema");

  const runOutcomeDetection = async () => {
    try {
      const orgs = await actionDb.select({ id: orgsTable.id }).from(orgsTable).limit(100);
      for (const org of orgs) {
        await detectOutcomesForOrg(org.id).catch(() => {});
      }
    } catch (_) {}
  };

  const runAutoSendAndCampaigns = async () => {
    try {
      const orgs = await actionDb.select({ id: orgsTable.id, automationLevel: orgsTable.automationLevel }).from(orgsTable).limit(100);
      for (const org of orgs) {
        const level = org.automationLevel ?? 1;
        if (level >= 2) {
          await runCampaignEngine(org.id).catch(() => {});
        }
        if (level >= 3) {
          await executeAutoActions(org.id).catch(() => {});
        }
      }
    } catch (_) {}
  };

  setInterval(runOutcomeDetection, 30 * 60 * 1000);
  setInterval(runAutoSendAndCampaigns, 30 * 60 * 1000);

  // ─── Agent Pending Actions cleanup ───────────────────────────────────────
  // Mark expired rows every 15 minutes; also run once on startup.
  const runPendingActionsCleanup = async () => {
    try {
      const { storage: st } = await import("./storage");
      const count = await st.markExpiredAgentPendingActions();
      if (count > 0) console.log(`[PendingActionsCleanup] Marked ${count} expired pending action(s).`);
    } catch (err) {
      console.error("[PendingActionsCleanup] Error:", err);
    }
  };
  runPendingActionsCleanup();
  setInterval(runPendingActionsCleanup, 15 * 60 * 1000);

  // ─── Recurring Team Lead Research Job ────────────────────────────────────
  const runRecurringTeamLeadResearch = async () => {
    if (!process.env.OPENAI_API_KEY) return;
    try {
      const { storage: st } = await import("./storage");
      const due = await st.getOrganizationsDueForRecurringResearch(new Date());
      for (const settings of due) {
        const orgId = settings.organizationId;
        if (!settings.defaultLocation?.trim()) {
          console.warn(`[Team Leads Recurring Research] orgId=${orgId} skipped — no defaultLocation`);
          continue;
        }
        console.log(`[Team Leads Recurring Research] orgId=${orgId} status=started`);
        try {
          await st.logOutreachEvent({
            orgId,
            eventType: "recurring_research_started",
            description: `Recurring research started. Location: ${settings.defaultLocation}, Radius: ${settings.radiusMiles}mi`,
            metadata: { location: settings.defaultLocation, radiusMiles: settings.radiusMiles, sport: settings.recurringSport, limit: settings.recurringLimit },
          });

          const org = await st.getOrganizationById(orgId);
          if (!org) continue;

          const { researchProspects, scoreProspect, applyLeadQualityGate, normalizeDomain,
                  getRotatedCategory, getRotatedLocation, nextCategoryIndex, nextLocationIndex } = await import("./team-training-prospecting");

          // Load existing leads BEFORE research for exclusion list + duplicate detection
          const existingProspects = await st.getTeamTrainingProspects(orgId);
          const existingNames = existingProspects.map((p: any) => p.prospectName);
          const existingDomains = existingProspects
            .flatMap((p: any) => [normalizeDomain(p.websiteUrl), normalizeDomain(p.sourceUrl)])
            .filter(Boolean) as string[];

          // Rotate category and location for this run
          const catIdx = settings.lastSearchCategoryIndex ?? 0;
          const locIdx = settings.lastSearchLocationIndex ?? 0;
          const searchCategory = getRotatedCategory(catIdx);
          const searchLocation = getRotatedLocation(settings.defaultLocation, locIdx);

          console.log(`[Team Leads Recurring Research] orgId=${orgId} category="${searchCategory}" location="${searchLocation}"`);

          const runResearch = async (category: string, loc: string) =>
            researchProspects(
              org,
              settings.defaultLocation,
              settings.recurringSport && settings.recurringSport !== "all" ? settings.recurringSport : undefined,
              settings.recurringLimit ?? 8,
              settings.radiusMiles ?? 25,
              { excludeNames: existingNames, excludeDomains: existingDomains, searchCategory: category, searchLocation: loc }
            );

          let results = await runResearch(searchCategory, searchLocation);

          let created = 0;
          let rejected = 0;
          let duplicates = 0;
          let needsContact = 0;

          const processAndSave = async (batch: typeof results) => {
            for (const p of batch) {
              const scored = scoreProspect(p);
              const gate = applyLeadQualityGate(p, scored, existingNames, existingDomains);

              if (gate.action === "duplicate") {
                duplicates++;
                try {
                  await st.logDiscoveryAttempt({
                    orgId,
                    prospectId: null,
                    prospectName: p.prospectName,
                    query: p.discoveryQuery || null,
                    sourceUrl: p.discoverySourceUrl || null,
                    confidence: p.discoveryConfidenceScore ?? null,
                    result: "duplicate",
                    action: "recurring_research",
                    notes: `Recurring: duplicate skipped`,
                  });
                } catch {}
                continue;
              }
              if (gate.action === "reject") {
                rejected++;
                try {
                  await st.logDiscoveryAttempt({
                    orgId,
                    prospectId: null,
                    prospectName: p.prospectName,
                    query: p.discoveryQuery || null,
                    sourceUrl: p.discoverySourceUrl || null,
                    confidence: p.discoveryConfidenceScore ?? null,
                    result: "rejected",
                    action: "recurring_research",
                    notes: `Recurring: rejected — ${gate.reason || "low quality"}`,
                  });
                } catch {}
                continue;
              }

              const prospect = await st.createTeamTrainingProspect({
                orgId,
                prospectName: p.prospectName,
                organizationType: p.organizationType,
                sport: p.sport,
                city: p.city,
                state: p.state,
                websiteUrl: p.websiteUrl,
                contactName: p.contactName,
                contactRole: p.contactRole,
                contactEmail: p.contactEmail,
                contactPhone: p.contactPhone,
                sourceUrl: p.sourceUrl,
                confidenceScore: scored,
                outreachStatus: "Needs Review",
                notes: p.notes,
                decisionMakerName: p.decisionMakerName,
                decisionMakerTitle: p.decisionMakerTitle,
                decisionMakerEmail: p.decisionMakerEmail,
                contactConfidence: p.contactConfidence,
                contactSourceUrl: p.contactSourceUrl,
                contactQuality: p.contactQuality,
              });
              existingNames.push(p.prospectName);
              created++;
              if (gate.needsContact) needsContact++;

              try {
                await st.logDiscoveryAttempt({
                  orgId,
                  prospectId: prospect.id,
                  prospectName: p.prospectName,
                  query: p.discoveryQuery || null,
                  sourceUrl: p.discoverySourceUrl || null,
                  confidence: p.discoveryConfidenceScore ?? null,
                  result: "created",
                  action: "recurring_research",
                  notes: `Recurring: Confidence ${Math.round((p.discoveryConfidenceScore || 0) * 100)}% | Method: ${p.discoveryMethod || "unknown"} | Status: ${p.leadValidationStatus || "likely_valid"}`,
                });
              } catch {}
            }
          };

          await processAndSave(results);

          // If ALL were duplicates, run one fallback with a different category/location
          if (results.length > 0 && created === 0 && rejected === 0 && duplicates === results.length) {
            console.log(`[Team Leads Recurring Research] orgId=${orgId} all duplicates — running diversified fallback`);
            const fallbackCategory = getRotatedCategory((catIdx + 1) % 20);
            const fallbackLocation = getRotatedLocation(settings.defaultLocation, (locIdx + 1) % 10);
            const fallbackResults = await runResearch(fallbackCategory, fallbackLocation);
            await processAndSave(fallbackResults);
          }

          // Advance rotation indices for next run
          await st.upsertTeamLeadSettings(orgId, {
            lastSearchCategoryIndex: nextCategoryIndex(catIdx),
            lastSearchLocationIndex: nextLocationIndex(settings.defaultLocation, locIdx),
          } as any);

          // Compute next run time in the org's local timezone so "8:00 AM"
          // always means 8:00 AM org-local time, stored as UTC in the DB.
          const nowUtc = new Date();
          const freq = settings.recurringFrequency || "weekly";
          const preferredTime = settings.recurringTime || "08:00";
          const [hStr, mStr] = preferredTime.split(":");
          const prefH = parseInt(hStr, 10) || 8;
          const prefM = parseInt(mStr, 10) || 0;
          const orgTz = (org as any).timezone || "America/New_York";

          // Advance from today in local time, then set preferred H:M
          const nowLocal = toZonedTime(nowUtc, orgTz);
          const nextLocal = new Date(nowLocal);
          if (freq === "daily") nextLocal.setDate(nextLocal.getDate() + 1);
          else if (freq === "monthly") nextLocal.setMonth(nextLocal.getMonth() + 1);
          else nextLocal.setDate(nextLocal.getDate() + 7);
          nextLocal.setHours(prefH, prefM, 0, 0);
          // Convert local candidate back to UTC for DB storage
          const nextRunAt = fromZonedTime(nextLocal, orgTz);

          await st.updateTeamLeadLastRun(orgId, nowUtc, nextRunAt);

          await st.logOutreachEvent({
            orgId,
            eventType: "recurring_research_completed",
            description: `Recurring research completed. Saved ${created}, rejected ${rejected}, skipped ${duplicates} duplicates near ${settings.defaultLocation}. Angle: ${searchCategory} • ${searchLocation}`,
            metadata: {
              count: created, rejected, duplicates, needsContact,
              location: settings.defaultLocation, radiusMiles: settings.radiusMiles, sport: settings.recurringSport,
              primarySearchAngle: { category: searchCategory, location: searchLocation },
              activeCategory: searchCategory, activeLocation: searchLocation,
            },
          });

          console.log(`[Team Leads Recurring Research] orgId=${orgId} status=completed leads=${created} rejected=${rejected} duplicates=${duplicates}`);
        } catch (err: any) {
          console.error(`[Team Leads Recurring Research] orgId=${orgId} status=failed error=${err.message}`);
          try {
            const { storage: st2 } = await import("./storage");
            await st2.logOutreachEvent({
              orgId,
              eventType: "recurring_research_failed",
              description: `Recurring research failed: ${err.message}`,
              metadata: { error: err.message },
            });
          } catch {}
        }
      }
    } catch (err: any) {
      console.error("[Team Leads Recurring Research] Cron error:", err.message);
    }
  };

  setInterval(runRecurringTeamLeadResearch, 60 * 60 * 1000); // every hour
  // Also check for any missed runs shortly after startup (in case server restarted during a scheduled window)
  setTimeout(runRecurringTeamLeadResearch, 2 * 60 * 1000); // 2 minutes after start

  // ─── Financial Event Retry Cron ──────────────────────────────────────────
  // Retries pending financial_event_failures every 15 minutes (max 5 attempts per failure).
  const runFinancialEventRetryCron = async () => {
    try {
      const { runFinancialEventRetry } = await import("./financial-event-retry-cron");
      await runFinancialEventRetry();
    } catch (err: any) {
      console.error("[FinancialEventRetry] Cron wrapper error:", err?.message ?? err);
    }
  };
  setInterval(runFinancialEventRetryCron, 15 * 60 * 1000);

  // ─── Athlete Context Object Daily Refresh Cron ────────────────────────────
  // Rebuilds living athlete context objects for all athletes with active programs.
  // Runs once daily. Also runs 5 minutes after startup to catch any missed refresh.
  const runAthleteContextRefreshCron = async () => {
    try {
      const { runDailyAthleteContextRefreshCron } = await import("./services/athlete-context-broker");
      await runDailyAthleteContextRefreshCron();
    } catch (err: any) {
      console.error("[AthleteContextCron] Error:", err?.message ?? err);
    }
  };
  setInterval(runAthleteContextRefreshCron, 24 * 60 * 60 * 1000); // every 24 hours
  setTimeout(runAthleteContextRefreshCron, 5 * 60 * 1000); // 5 minutes after startup

  // ─── Intervention Outcome Evaluation Cron ────────────────────────────────
  // Auto-evaluates approved interventions that have passed their 7-day window.
  // Runs every 6 hours to keep outcome data fresh across all orgs.
  const runOutcomeEvalCron = async () => {
    try {
      const { db: dbInst } = await import("./db");
      const { orgMemberships } = await import("@shared/schema");
      const { eq: eqFn, sql: sqlFn } = await import("drizzle-orm");
      const { runOutcomeEvaluationCron } = await import("./services/intervention-learning-engine");
      // Get distinct orgs with active members
      const orgs = await dbInst.selectDistinct({ orgId: orgMemberships.orgId })
        .from(orgMemberships).limit(50).catch(() => []);
      let total = 0;
      for (const { orgId } of orgs) {
        const result = await runOutcomeEvaluationCron(orgId).catch(() => ({ evaluated: 0, errors: 0 }));
        total += result.evaluated;
      }
      if (total > 0) console.log(`[OutcomeEvalCron] Evaluated ${total} outcomes across ${orgs.length} orgs`);
    } catch (err: any) {
      console.error("[OutcomeEvalCron] Error:", err?.message ?? err);
    }
  };
  setInterval(runOutcomeEvalCron, 6 * 60 * 60 * 1000); // every 6 hours

  // ─── Phase 4: Event-Driven Organization Intelligence ─────────────────────
  // Initialize the orchestrator (registers all event bus subscriptions).
  const { initializeOrchestrator } = await import("./orchestration/organization-intelligence-orchestrator");
  initializeOrchestrator();

  // ─── Phase 4: Daily Operations Engine Cron ───────────────────────────────
  // Generates a proactive daily brief each morning and on a 6-hour cycle.
  const runDailyOpsCron = async () => {
    try {
      const { runDailyOperationsCron } = await import("./services/daily-operations-engine");
      const result = await runDailyOperationsCron();
      if (result.orgs > 0) console.log(`[DailyOps] Brief generated for ${result.orgs} orgs (${result.errors} errors)`);
    } catch (err: any) {
      console.error("[DailyOps] Cron error:", err?.message ?? err);
    }
  };
  setInterval(runDailyOpsCron, 6 * 60 * 60 * 1000); // every 6 hours
  // Run at 6 AM each day via a smart scheduler (first run: 8 minutes after startup)
  setTimeout(runDailyOpsCron, 8 * 60 * 1000);

  // ─── Lead Recovery Cron ──────────────────────────────────────────────────
  // Queues follow-up drafts for leads whose follow-up window has passed.
  // Never auto-sends — all drafts require approval. Runs every 15 minutes.
  const { startLeadRecoveryCron } = await import("./services/lead-recovery-cron");
  startLeadRecoveryCron(15 * 60 * 1000);

  const { fixServiceTypes } = await import("./fix-service-types");
  await fixServiceTypes();

  // ─── Workflow Orchestration Runner ───────────────────────────────────────
  const { startWorkflowRunner } = await import("./workflow-runner");
  startWorkflowRunner();

  const { startWorkflowJobRunner } = await import("./workflow-job-runner");
  startWorkflowJobRunner();

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  console.log("[ENV CHECK] OPENAI_API_KEY exists:", !!process.env.OPENAI_API_KEY);

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
