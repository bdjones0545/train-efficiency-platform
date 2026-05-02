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
-   **Unified Business Agent (TrainEfficiency Business Agent):** Consolidates the Scheduling Agent and Team Training Prospecting Agent into a single co-pilot, sharing tools and UI surfaces for both scheduling and B2B prospecting.
-   **Today's Business Command Center:** A mobile-first dashboard at `/command-center` surfacing real-time revenue snapshots (today's bookings, open slot value, month-to-date), the single best action recommendation (from the scored action queue), schedule gap cards with fill-value estimates, client opportunity alerts (churn risk, renewal, upsell), team training pipeline summary, and one-tap agent quick-action buttons. Monthly revenue goal with progress bar, set via POST /api/business-command-center/monthly-goal. Backend context is also injected into the scheduling agent system prompt for richer AI responses.

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