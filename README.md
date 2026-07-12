# TrainEfficiency

**An AI-native operating system for coaching organizations — CRM, scheduling, billing, athlete management, communications, and specialized AI agents in one multi-tenant, white-label platform.**

## Overview

TrainEfficiency (a.k.a. Train Efficiency Business Solutions) is a full-stack platform that lets strength-and-conditioning coaching businesses, private facilities, schools, sports organizations, and healthcare providers run their entire operation from a single branded environment. It goes beyond a scheduling tool or CRM: it unifies lead capture, bookings, payments, athlete history, programming, and communications, and layers a network of specialized AI agents on top to automate routine work and surface organizational intelligence.

The platform is multi-tenant by design — each organization is an isolated, white-labeled workspace — and AI is treated as a first-class platform capability rather than a bolt-on feature. Human coaches and administrators remain the final decision-makers; the AI amplifies them.

## Features

- **Multi-tenant, white-label workspaces** — per-organization isolation via `organization_id`, custom branding (logos, taglines, colors), and dynamic landing pages.
- **Role-based access control** — `CLIENT`, `COACH`, `ADMIN`, and `STAFF` roles with server-side authorization enforcement.
- **Scheduling & bookings** — coach availability, client booking workflows, appointment management, and Google Calendar integration.
- **CRM & lead management** — funnels, lead scoring, prospect lifecycle tracking, and a Deal Pipeline / Close Engine for team-training prospects.
- **Athlete management** — longitudinal athlete profiles, attendance, assessments, goals, and progress tracking.
- **Training & programming** — workout/program builder, exercise library, templates, and AI-assisted programming.
- **Billing & commerce** — Stripe-backed subscriptions, one-time purchases, wallets, checkout, promotional codes, and idempotent webhook processing.
- **Communications** — transactional email (SendGrid), SMS with consent/STOP-START handling (Twilio), AI agent inboxes (AgentMail), and in-app notifications.
- **AI agent operating system** — nine canonical specialized agents (executive, retention, growth, scheduling, finance, communication, research, workflow, and system) coordinated by an admin-chat orchestrator, with governance, organizational memory, and observable tool-calling.
- **AI scheduling assistant** — conversational booking powered by OpenAI function calling.
- **Team-training prospecting agent** — automated lead research and outreach, including live web-search contact enrichment with source-backed evidence (source link, snippet, confidence score, and stale-data warnings).
- **Executive Operating System** — cross-domain dashboards, CEO Heartbeat, and executive recommendations that summarize organizational health.
- **Automation & background jobs** — event-driven workflows and scheduled tasks designed to be retry-safe and organization-aware, with an optional durable job queue and a global emergency off-switch for automated outreach.

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix UI), Wouter (routing), TanStack Query, React Hook Form + Zod |
| **Backend** | Node.js, Express 5, TypeScript |
| **Database** | PostgreSQL, Drizzle ORM (schema in `shared/schema.ts`) |
| **Auth** | Replit Auth / OpenID Connect (clients), email + password with bcryptjs (coaches), Passport, express-session |
| **AI** | OpenAI (primary), OpenRouter (multi-model routing & fallback) |
| **Payments** | Stripe (incl. Stripe Connect) |
| **Email / SMS** | SendGrid, AgentMail, Twilio |
| **Integrations** | Google APIs (Gmail, Calendar), Composio (governed tool-calling), Meta Pixel / Conversions API, Google Cloud Storage |
| **Build tooling** | Vite + esbuild (via `tsx`), TypeScript 5.6 |
| **Package manager** | npm (see `package-lock.json`) |

## Getting Started

### Prerequisites

- **Node.js 20** (see `.replit` modules)
- **PostgreSQL 16** (or a compatible Postgres instance)
- **npm** (bundled with Node)

### Install

```bash
npm install
```

### Configure environment variables

Copy the example file and fill in real values (or set them as Replit Secrets / deployment env vars):

```bash
cp .env.example .env
```

Key variables (see `.env.example` for the full, annotated list):

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string |
| `NODE_ENV` | — | `development` or `production` |
| `PORT` | — | HTTP port (defaults to `5000`) |
| `SESSION_SECRET` | Required in prod | Signs sessions and OAuth-state HMACs |
| `CREDENTIAL_ENCRYPTION_KEY` | Required in prod | AES-256-GCM key for the credentials vault (≥32 chars, must differ from `SESSION_SECRET`) |
| `ADMIN_REPAIR_KEY` | — | Gates admin "repair" endpoints (fails closed if unset) |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MARKETPLACE_WEBHOOK_SECRET` | — | Payments & webhooks |
| `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | — | AI providers |
| `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_INBOUND_SECRET` | — | Transactional & inbound email |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | — | SMS |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | Gmail & Google Calendar |
| `COMPOSIO_API_KEY` | — | Governed tool-calling |
| `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET` | — | AI agent inboxes |
| `META_CAPI_TOKEN`, `META_BOOK_ACCESS_TOKEN` | — | Meta marketing attribution |
| `USE_WORKFLOW_JOB_QUEUE` | — | Enables the durable, idempotent workflow job queue |
| `AUTOMATION_SENDS_ENABLED` | — | Emergency off-switch for automated outreach sends |

> In production (`NODE_ENV=production`) the server **fails closed at startup** if any secret marked required is missing (see `server/lib/secrets.ts`).

### Apply the database schema

Schema changes are pushed directly from `shared/schema.ts` with Drizzle Kit:

```bash
npm run db:push
```

> `drizzle-kit push` can be destructive and there is currently no committed migration history — review the diff and back up the database before applying changes in a shared environment.

### Run in development

```bash
npm run dev
```

Starts the Express server (with Vite middleware) via `tsx` on `PORT` (default `5000`).

### Build for production

```bash
npm run build
```

Runs a full client typecheck, builds the client with Vite, and bundles the server to `dist/index.cjs` with esbuild.

### Start the production server

```bash
npm start
```

Runs `node dist/index.cjs` with `NODE_ENV=production` (build first).

### Typecheck

```bash
npm run check
```

## Project Structure

```
train-efficiency-platform/
├── client/                 # React + TypeScript frontend (Vite)
│   └── src/
│       ├── pages/          # Route-level pages (dashboards, admin, funnels)
│       ├── components/     # Reusable UI components (shadcn/ui)
│       ├── hooks/          # React hooks
│       ├── lib/            # Frontend utilities
│       └── App.tsx         # App shell & routing (Wouter)
├── server/                 # Express API, business logic & AI orchestration
│   ├── agents/             # Specialized AI agents
│   ├── agent-sdk/          # Agent tooling & runtime
│   ├── email-agent/        # Team-training prospect outreach intelligence layer
│   ├── services/           # Domain services (integrations, status, etc.)
│   ├── integrations/       # External provider adapters
│   ├── orchestration/      # Agent orchestration
│   ├── lib/                # Server utilities (secrets, org resolution, ...)
│   └── index.ts            # Server entrypoint
├── shared/                 # Code shared between client & server
│   ├── schema.ts           # Drizzle database schema (source of truth)
│   └── models/             # Auth & chat sub-models
├── docs/                   # Architecture, integrations, schema & API conventions
├── script/                 # Build & maintenance scripts (build.ts, ...)
├── public/                 # Static assets
├── drizzle.config.ts       # Drizzle Kit config (points at shared/schema.ts)
├── vite.config.ts          # Vite config
├── tailwind.config.ts      # Tailwind config
└── CLAUDE.md               # Engineering guide & architectural reference
```

## Deployment

The repository is configured for **Replit** deployment:

- `.replit` defines an `autoscale` deployment target that builds with `npm run build` and serves `dist/index.cjs`, publishing `dist/public` as the static directory. Local port `5000` maps to external port `80`.
- Provisioned modules include Node.js 20, PostgreSQL 16, and Python 3.11.
- Production secrets are managed via **Replit Secrets** rather than committed to the repo, and non-secret production values (e.g. `PUBLIC_APP_URL`) are set under `[userenv.production]`.

The build output is a self-contained Node bundle, so the app can also run on any Node 20 host with a reachable PostgreSQL database and the required environment variables set.

## Further Reading

Deeper architecture, integration inventories, schema notes, API conventions, and runbooks live in [`CLAUDE.md`](./CLAUDE.md) and the [`docs/`](./docs) directory.
