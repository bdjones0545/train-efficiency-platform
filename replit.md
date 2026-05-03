# Train Efficiency Business Solutions

## Overview
Train Efficiency Business Solutions is a multi-tenant, white-label scheduling platform designed for strength and conditioning coaching businesses. Its primary purpose is to streamline operations for business owners, enabling them to manage coaches, clients, and sessions efficiently under their own brand. The platform aims to enhance client engagement, provide robust administrative tools, and become the leading scheduling and management solution in the specialized strength and conditioning market. Key capabilities include multi-tenancy, role-based access control, dynamic content customization, and integrated payment processing.

## User Preferences
I prefer iterative development with regular check-ins.
Please use clear and concise language in all explanations.
Focus on delivering functional features quickly.
I appreciate detailed explanations for complex architectural decisions.
Do not make changes to the folder `node_modules`.
Do not make changes to the file `.env`.

## System Architecture
The application employs a client-server architecture. The frontend is developed using **React, TypeScript, Tailwind CSS, and Shadcn UI** with Vite. The backend is an **Express.js** application (TypeScript) handling API requests and business logic. **PostgreSQL** serves as the database, accessed via **Drizzle ORM**. Authentication for clients uses **Replit Auth (OpenID Connect)**, while coaches utilize a custom email/password system (`bcryptjs`). Client-side routing is managed by **Wouter**.

**Core Architectural Decisions:**
-   **Multi-Tenancy:** Organizations are isolated using an `organization_id` for distinct branded environments and dynamic landing pages.
-   **Role-Based Access Control (RBAC):** Implements `CLIENT`, `COACH`, `ADMIN`, and `STAFF` roles for secure access.
-   **UI/UX Design:** Features a dark mode with a vibrant green primary color, Inter font, and consistent design through Shadcn UI components.
-   **Dynamic Content & White-Labeling:** Allows extensive customization of branding (logos, taglines, colors).
-   **Payment Processing:** Integrates with **Stripe** for organizational subscriptions and individual session payments.
-   **Notification System:** Utilizes **SendGrid** for email communications.
-   **Forgot/Reset Password System:** A secure, unified password reset flow with expiring, single-use, hashed tokens.
-   **AI Integration:** An AI Scheduling Assistant chatbot, powered by **OpenAI's** function calling, facilitates conversational scheduling and booking.
-   **Booking System:** Supports 1:1, semi-private, and team training sessions, with coach availability management and session redemption.
-   **Admin Tools:** Provides dashboards for user management, service configuration, booking oversight, and CSV data export.
-   **Athletic Scheduling:** A multi-organizational, multi-program system for managing athletic programs.
-   **Wallet & Transactions:** Coaches have a "Transactions" page detailing financial activities, with admin control over visibility.
-   **Subscription Management:** Organizations can enable Stripe subscriptions, track products, and manage client subscriptions.
-   **Operations Intelligence Engine:** Computes an organizational operations digest (coach utilization, revenue opportunities, inactive clients).
-   **Revenue Intelligence Engine:** Calculates comprehensive revenue analytics (LTV, churn risks, upsell opportunities).
-   **Client Intelligence Engine:** Powers per-client behavioral profiling, including response profiles, segmentation, LTV scores, and strategic recommendations.
-   **Goal-Oriented Optimization Engine:** Enables weekly performance target-setting and goal-driven action prioritization, integrating with the AI agent.
-   **Global Coach Agent Launcher:** A floating UI component that provides quick access to the AI agent in an overlay, with context-aware prompts and badging for high-priority items.
-   **Session Category System:** A robust system for classifying services (e.g., `paid`, `intro`, `membership`) with detailed operational columns for revenue recognition, coach payouts, utilization tracking, and booking access control.
-   **Organization Media System:** A multi-tenant media library for uploading and displaying images/videos across public landing pages, with dedicated admin UI and API routes.
-   **Team Training Prospecting Agent:** A backend admin agent for discovering and outreaching to local sports organizations, featuring lead management, AI-driven research, email draft generation, and a secure two-step approval/send process.
-   **Email Agent (Outreach Command Center):** Located at `/coach/communications` (sidebar: "Email Agent"). Full 7-tab command center: Overview, Prospects, Drafts, Sent, Follow-Ups, Settings. Features: open/click/reply tracking, A/B variant testing with auto-optimization every 50 emails, reply intelligence (AI classifies replies as interested/not_interested/ask_info/referral/wrong_contact/out_of_office/unknown), automated 3-step follow-up sequences (Day 3/7/14) that stop on reply/DNC/opt-out. Follow-up cron runs hourly. AI scheduling agent receives email performance + follow-up context. Schema: `email_follow_ups` table, `email_message_variants` table, tracking columns on `team_training_outreach_drafts`. New files: `server/email-agent/reply-classifier.ts`, `server/email-agent/follow-up-cron.ts`.
-   **Team Training Deal Pipeline & Close Engine:** Located at `/admin/team-training-deals` (sidebar: "Deal Pipeline" under Growth). Kanban board with columns: New, Interested, Call Scheduled, Proposal Sent, Won, Lost. Drag-and-drop to update deal status. Each card shows team name, sport, estimated value, last activity, next action, probability. Auto-creates deals when a prospect reply is classified as `interested` or `ask_info`. AI Close Assistant per deal: "Generate Response", "Suggest Next Step", "Create Proposal" — powered by GPT-4o-mini with full deal + prospect context. Deal-aware follow-up cron skips cold follow-ups for prospects already in active deals. When a deal is marked "Won", logs an outreach event and updates the revenue dashboard. Deal pipeline stats (active, interested, negotiating, projected revenue) injected into agent context — if pipeline is full (5+ active deals), agent prioritizes closing over new cold outreach. Schema: `team_training_deals` table, `deal_status` enum. Routes: GET/POST/PATCH/DELETE `/api/admin/team-training/deals[/:id]`, POST `/api/admin/team-training/deals/:id/ai-action`, GET `/api/admin/team-training/deals/pipeline-stats`.
-   **Unified Business Agent (TrainEfficiency Business Agent):** Consolidates the Scheduling Agent and Team Training Prospecting Agent into a single co-pilot, sharing tools and UI surfaces for both scheduling and B2B prospecting.
-   **Today's Business Command Center:** A mobile-first dashboard at `/command-center` surfacing real-time revenue snapshots (today's bookings, open slot value, month-to-date), the single best action recommendation (from the scored action queue), schedule gap cards with fill-value estimates, client opportunity alerts (churn risk, renewal, upsell), team training pipeline summary, and one-tap agent quick-action buttons. Monthly revenue goal with progress bar, set via POST /api/business-command-center/monthly-goal. Backend context is also injected into the scheduling agent system prompt for richer AI responses.
-   **High-Confidence Auto-Execution Layer:** Sits on top of the Global Priority Engine and automatically executes top-priority actions when safety thresholds are met. Engine: `server/email-agent/auto-execution-engine.ts`. Logic: `isAutoExecutable()` checks confidence=high, riskScore<40, action type is `send_follow_up`/`generate_draft`/`send_initial_email`, daily count < max (default 3), no DNC/opted-out. `runAutoExecution(orgId)` finds the first eligible action from the global queue and executes it (sends follow-up via full cron logic, or generates draft with optional auto-send). Execution log stored in `app_settings` key `auto_execution_log_${orgId}` (last 50 entries). Undo: `undoAutoExecution()` cancels follow-up sequences or marks drafts as unprocessed. Agent context: `buildAutoExecContextString()` injects enabled status, today count, success rate into the AI system prompt. Routes: `POST /api/email-agent/auto-execute/run`, `POST /api/email-agent/auto-execute/undo/:executionId`, `GET /api/email-agent/auto-execute/log`. Settings: new `autoExecuteEnabled` (default false) and `autoExecuteMaxPerDay` (default 3) fields on `EmailAgentSettings`. UI: Toggle in Email Agent Settings tab; `AutoExecLogSection` in Overview tab shows stats (today/max, success rate, all-time count) + scrollable log with per-entry Undo buttons; `useAutoExecution()` hook mounted on both Command Center and Email Agent pages — fires once per session 2s after load if enabled, shows toast "AI executed: [Action Type] — [Title]" with 8-second Undo button. Guardrails: blocked action types include `create_deal`, `schedule_call`, `create_proposal`, `generate_response`, `mark_do_not_contact`, `stop_sequence`.
-   **Global Priority Engine:** A unified cross-system priority ranking engine (`server/email-agent/global-priority-engine.ts`) that ranks ALL possible actions across prospects, follow-ups, deals, outreach, and risks into a single `globalActionQueue[]`. Scoring formula: `priorityScore = (revenue * 0.35) + (urgency * 0.25) + (likelihood * 0.25) - (risk * 0.15) + effort_bonus`. API: `GET /api/email-agent/intelligence/global-priority` returns `{ topAction, topThree, fullQueue }`. UI: A "Top Priority" fire card with "Execute Now" button is rendered at the VERY TOP of both the Command Center (`/command-center`) and Email Agent (`/coach/communications`) pages. Agent injection: global priority context (top action + why + top 3) is injected into the AI scheduling agent system prompt so it always recommends the top priority action first. Guardrails: never surfaces DNC/opted-out prospects, caps display at 5 actions, high-value warm leads always outrank cold outreach.

## External Dependencies
-   **PostgreSQL:** Database.
-   **Express.js:** Backend framework.
-   **React:** Frontend library.
-   **Tailwind CSS:** Styling framework.
-   **Shadcn UI:** UI component library.
-   **Vite:** Frontend build tool.
-   **Wouter:** Client-side router.
-   **Drizzle ORM:** ORM for TypeScript.
-   **Replit Auth (OpenID Connect):** Client authentication.
-   **Stripe:** Payment gateway and subscription management.
-   **bcryptjs:** Password hashing.
-   **SendGrid:** Email service.
-   **OpenAI API:** AI chatbot integration.