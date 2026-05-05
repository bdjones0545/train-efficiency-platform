import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrations } from 'stripe-replit-sync';
import { getStripeSync } from './stripeClient';
import { WebhookHandlers } from './webhookHandlers';

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

          const { researchProspects, scoreProspect } = await import("./team-training-prospecting");
          const results = await researchProspects(
            org,
            settings.defaultLocation,
            settings.recurringSport && settings.recurringSport !== "all" ? settings.recurringSport : undefined,
            settings.recurringLimit ?? 8,
            settings.radiusMiles ?? 25
          );

          let created = 0;
          for (const p of results) {
            const scored = scoreProspect(p);
            await st.createTeamTrainingProspect({
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
            });
            created++;
          }

          // Compute next run time
          const now = new Date();
          const nextRunAt = new Date(now);
          const freq = settings.recurringFrequency || "weekly";
          if (freq === "daily") nextRunAt.setDate(now.getDate() + 1);
          else if (freq === "monthly") nextRunAt.setMonth(now.getMonth() + 1);
          else nextRunAt.setDate(now.getDate() + 7);

          await st.updateTeamLeadLastRun(orgId, now, nextRunAt);

          await st.logOutreachEvent({
            orgId,
            eventType: "recurring_research_completed",
            description: `Recurring research completed. Found ${created} prospects near ${settings.defaultLocation}`,
            metadata: { count: created, location: settings.defaultLocation, radiusMiles: settings.radiusMiles, sport: settings.recurringSport },
          });

          console.log(`[Team Leads Recurring Research] orgId=${orgId} status=completed leads=${created}`);
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
  const { fixServiceTypes } = await import("./fix-service-types");
  await fixServiceTypes();
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
