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
-   **Multi-Tenancy:** Organizations are isolated using an `organization_id`, supporting distinct branded environments and dynamic landing pages.
-   **Role-Based Access Control (RBAC):** Implements `CLIENT`, `COACH`, `ADMIN`, and `STAFF` roles for secure access to features and APIs.
-   **UI/UX Design:** Features a dark mode with a vibrant green primary color, Inter font, and consistent design through Shadcn UI components.
-   **Dynamic Content & White-Labeling:** Allows extensive customization of branding, including logos, taglines, and colors.
-   **Payment Processing:** Integrates with **Stripe** for organizational subscriptions and individual session payments, allowing organizations to connect their own Stripe accounts.
-   **Notification System:** Utilizes **SendGrid** for various email communications.
-   **Forgot/Reset Password System:** A secure, unified password reset flow for all account types (coaches, admins, clients). Uses cryptographically random tokens hashed with SHA-256 before storage, stored in a dedicated `password_reset_tokens` table. Tokens expire after 1 hour, are single-use, and prior tokens are invalidated on each new request. Rate-limited by IP and email. Frontend pages at `/forgot-password` and `/reset-password`. "Forgot password?" link in the coach login modal on the landing page.
-   **AI Integration:** An AI Scheduling Assistant chatbot, powered by **OpenAI's** function calling, facilitates conversational scheduling and booking.
-   **Booking System:** Supports 1:1, semi-private, and team training sessions, with coaches managing availability and session redemption.
-   **Admin Tools:** Provides dashboards for user management, service configuration, booking oversight, and CSV data export.
-   **Athletic Scheduling:** A multi-organizational, multi-program system for managing athletic programs with configurable teams, training types, and schedules.
-   **Wallet & Transactions:** Coaches have a "Transactions" page detailing credits, debits, and balances, with admin control over visibility.
-   **Subscription Management:** Organizations can enable Stripe subscriptions, track products, and manage client subscriptions with defined cancellation policies. This includes recurring session schedules linked to subscription plans and specific payout rules for subscription-linked sessions.
-   **Operations Intelligence Engine:** A module (`server/scheduling-intelligence.ts`) computes an organizational operations digest, including coach utilization, open slot revenue opportunities, inactive client detection, and prioritized insight cards.
-   **Revenue Intelligence Engine:** A module (`server/revenue-intelligence.ts`) calculates comprehensive revenue analytics, including LTV, churn risks, upsell opportunities, and session package alerts.
-   **Client Intelligence Engine:** A module (`server/client-intelligence.ts`) powers per-client behavioral profiling and strategic decision-making:
    -   **Client Response Profiles** (`computeClientResponseProfile`): Per-client preferred send hour, preferred message type, average touches before conversion, response/conversion rates, 30-day trend, and a `clientConversionModifier` used to adjust action scores.
    -   **Client Segmentation** (`computeClientSegments`): Groups all clients into strategic segments (High Value Low Frequency, High Churn Risk High Recovery, Frequent Responders, Low Responders, High LTV Active, Inactive Historically Consistent) with recommended strategy per segment.
    -   **Client LTV Scores** (`computeClientLtvScore`): Computes total spend, retention days, avg monthly spend, projected annual value, LTV tier (platinum/gold/silver/at_risk/new), and churn risk per client.
    -   **Strategic Recommendations** (`getStrategicRecommendations`): Combines segmentation + LTV data to recommend the week's focus (retention/growth/reactivation/balanced), top priorities, revenue at risk, biggest upside, things to reduce, and a ranked list of clients to contact today.
-   **Client-Adjusted Action Scoring** (Phase 3): `buildScoredDailyActionQueue` now applies a `clientConversionModifier` per client, making action scores proportional to each individual client's historical response behavior rather than global averages only.
-   **Goal-Oriented Optimization Engine:** A module (`server/goal-tracking.ts`) enables weekly performance target-setting and goal-driven action prioritization:
    -   **Weekly Targets** (`setWeeklyTargets` / `getWeeklyTargets`): Coaches can set revenue, session count, retention rate, and utilization targets via the AI agent. Stored in `appSettings` under `weekly_targets_{orgId}`.
    -   **Weekly Progress Tracking** (`getWeeklyProgress`): Real-time progress against targets — % complete, gap to close, projected end-of-week outcome, on-track/at-risk/behind/exceeded status per dimension with urgency level.
    -   **Goal Priority Weights** (`getGoalPriorityWeights`): Computes per-dimension urgency multipliers (1.0–2.5×) based on how behind the org is on each target. Used in the scoring chain.
    -   **Goal-Adjusted Action Scoring**: `buildScoredDailyActionQueue` now applies a `goalPriorityWeight` per action: `finalScore = globalConvRate × clientModifier × expectedRevenue × urgencyWeight × goalPriorityWeight`. Actions contributing to behind-target dimensions are automatically boosted.
    -   **Goal Performance Summary** (`getGoalPerformanceSummary`): End-of-week recap showing target vs actual for each dimension, top contributing action types, best strategy, and what to change next week.
    -   **Strategic Recommendations Integration**: `getStrategicRecommendations` now includes `weeklyGoalStatus` — goal alerts are prepended to `topPriorityThisWeek` when targets are behind, giving goal context to the weekly focus.
    -   **Agent Tools**: Three new tools wired into the AI scheduling assistant — `set_weekly_targets`, `get_weekly_progress`, `get_goal_performance_summary` — with full system prompt guidance for natural language goal management.
-   **Global Coach Agent Launcher:** A floating Bot icon button (bottom-right, `z-50`, `52×52px`, safe-area-inset aware) mounts in `AuthenticatedLayout` via `CoachAgentLauncher` (`client/src/components/coach-agent-launcher.tsx`). It:
    -   Renders only for `COACH`, `ADMIN`, and `STAFF` roles (hidden for CLIENT/public).
    -   Hides automatically on the full agent page (`/scheduling/agent`) to avoid duplication.
    -   Shows a meaningful badge (high-priority count, "!", or "$NNN" open revenue) sourced from the cached `/api/scheduling/operations-digest` — refreshed every 10 minutes. No badge if nothing actionable.
    -   Pulses once (not constantly) when a new high-priority item appears.
    -   Opens the agent as a right-side Sheet overlay: full-screen on mobile (`w-full h-[100dvh]`), fixed 460px wide on desktop — no route change.
    -   Reuses `CoachSchedulingAgentPanel` (`client/src/components/coach-agent-panel.tsx`) in `mode="overlay"` with detected page context.
    -   Detects the current route and sets `sourcePage` (`schedule | clients | revenue | settings | dashboard`) — passed to the panel to drive page-specific quick prompts.
    -   Closing the overlay returns users exactly to where they were without any navigation.
-   **CoachSchedulingAgentPanel** (`client/src/components/coach-agent-panel.tsx`): Shared agent UI component extracted from `scheduling-agent.tsx`. Accepts `mode: "full" | "overlay"` and `context?: AgentContext`. In overlay mode: shows context-aware header label ("Agent · Schedule"), context-specific quick prompts per page, and a close button. In full mode: renders identically to the original standalone page. The original `scheduling-agent.tsx` page now simply renders `<CoachSchedulingAgentPanel mode="full" />`.
-   **Page-Specific Quick Prompts:** When opened from a specific page, the overlay shows tailored prompts: Schedule → fill openings/book/text; Clients → churn/follow-up/outreach; Revenue → goal tracking/money; Settings → automation mode/campaigns; Dashboard → daily priorities/recap.

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