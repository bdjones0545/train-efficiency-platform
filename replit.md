# Train Efficiency Business Solutions

Train Efficiency Business Solutions is a multi-tenant, white-label scheduling platform that helps strength and conditioning coaching businesses manage coaches, clients, and sessions efficiently under their own brand.

## Run & Operate
_Populate as you build_

## Stack
- **Frontend:** React, TypeScript, Tailwind CSS, Shadcn UI, Vite, Wouter
- **Backend:** Express.js (TypeScript)
- **Database:** PostgreSQL (Drizzle ORM)
- **Authentication:** Replit Auth (OpenID Connect for clients), custom email/password (bcryptjs for coaches)
- **AI:** OpenAI API
- **Email:** SendGrid
- **Payments:** Stripe

## Where things live
- `server/`: Backend API and business logic.
- `client/`: Frontend React application.
- `drizzle/`: Drizzle ORM schema and migrations.
- `server/db/schema.ts`: Database schema definition (source of truth).
- `server/email-agent/`: Email agent logic (e.g., `reply-classifier.ts`, `follow-up-cron.ts`).
- `server/email-agent/audit-engine.ts`: Email Agent health audit.
- `server/email-agent/auto-execution-engine.ts`: Auto-execution layer for AI actions.
- `server/email-agent/global-priority-engine.ts`: Ranks all actions into a single queue.
- `server/email-agent/revenue-outcome-engine.ts`: Tracks AI action revenue outcomes.
- `server/email-agent/trigger-logger.ts`: Logs all email trigger decisions.
- `client/src/pages/`: Frontend pages (e.g., `admin-team-training-leads.tsx`).
- `client/src/components/`: Reusable React components.
- `client/src/assets/`: Static assets (e.g., logos, images).

## Architecture decisions
- **Multi-Tenancy:** Organizations are isolated using an `organization_id` for distinct branded environments and dynamic landing pages.
- **Role-Based Access Control (RBAC):** Implements `CLIENT`, `COACH`, `ADMIN`, and `STAFF` roles for secure access.
- **Dynamic Content & White-Labeling:** Allows extensive customization of branding (logos, taglines, colors).
- **AI Integration:** An AI Scheduling Assistant chatbot, powered by OpenAI's function calling, facilitates conversational scheduling and booking. Additionally, an AI-driven Team Training Prospecting Agent assists with lead generation and outreach, and a Unified Business Agent combines these functionalities.
- **Intelligence Engines:** Includes Operations, Revenue, and Client Intelligence Engines for data analysis and a Goal-Oriented Optimization Engine for target-setting. A Global Priority Engine ranks cross-system actions, and a High-Confidence Auto-Execution Layer automates top-priority actions.
- **Revenue Outcome Engine:** Ties every AI action to real revenue outcomes via `ai_revenue_events` for multi-touch attribution.
- **Email Agent Upgrade (Phases 1-10):** Enhances email outreach with features like Audit Engine, Contact Quality Scoring, Conversation Stage Tracking, Adaptive Follow-Up Timing, and Auto-Execution Learning Loop.
- **Decision-Maker Contact Layer:** Lead research agent now actively searches for decision-makers (owner, AD, head coach, director, etc.) and scores leads by contact quality: `decision_maker` > `role_based` > `general` > `missing`. Leads with no email are penalized in scoring and blocked from email generation until enriched. `POST /api/team-training-leads/:id/enrich-contact` allows per-lead AI contact enrichment after creation.

## Product
- Multi-tenant scheduling platform for strength and conditioning businesses.
- Coach, client, and session management.
- Custom branding and dynamic content customization.
- Integrated payment processing (Stripe) for subscriptions and session payments.
- AI-powered scheduling and team training prospecting.
- Role-based access control.
- Notification system (SendGrid).
- Comprehensive admin tools and dashboards.
- Mobile-first "Today's Business Command Center" for real-time insights and quick actions.
- Deal Pipeline and Close Engine for managing team training prospects.
- Email Trigger Audit and Debug Panel for observability, with proactive Trigger Alerts and System Warnings.

## User preferences
I prefer iterative development with regular check-ins.
Please use clear and concise language in all explanations.
Focus on delivering functional features quickly.
I appreciate detailed explanations for complex architectural decisions.
Do not make changes to the folder `node_modules`.
Do not make changes to the file `.env`.

## Gotchas
_Populate as you build_

## Pointers
- **React Documentation:** `https://react.dev/`
- **Express.js Documentation:** `https://expressjs.com/`
- **Drizzle ORM Documentation:** `https://orm.drizzle.team/`
- **Tailwind CSS Documentation:** `https://tailwindcss.com/docs`
- **Shadcn UI Documentation:** `https://ui.shadcn.com/docs`
- **Replit Auth Documentation:** _(Link to Replit Auth docs)_
- **Stripe API Documentation:** `https://stripe.com/docs/api`
- **OpenAI API Documentation:** `https://platform.openai.com/docs/api-reference`
- **Wouter Documentation:** `https://www.npmjs.com/package/wouter`