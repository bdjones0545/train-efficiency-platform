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
-   **Session Category System (Training Options):** Each service (training option) now carries a `category` field (`paid`, `intro`, `internal`, `meeting`, `membership`, `package_redemption`, `comp`) plus 12 additional operational columns:
    -   `countsTowardRevenue` / `revenueRecognition` — controls whether and when a session counts toward revenue totals
    -   `payoutType` / `payoutValueCents` / `payoutPercent` / `coachPayWhenRedeemed` — independent coach payout logic (percentage, fixed, hourly, or none)
    -   `countsTowardUtilization` / `blocksAvailability` / `countsTowardSessionCount` — operational scheduling flags
    -   `requiresClient` / `isBookableByClient` / `isBookableByCoach` — booking access control
    -   The admin Training Options UI now has a comprehensive multi-section form with Quick Templates, a live payout preview, category-aware default inference, and rich card badges per service
    -   The booking API (`POST /api/bookings`) validates `isBookableByClient` and rejects restricted services with a 403
    -   Coach-facing session pickers (add-session-dialog, scheduling page) filter by `isBookableByCoach`
    -   Revenue functions (`computeRevenueSummary`, `computeRevenueByPeriod`) filter by `countsTowardRevenue`; utilization respects `countsTowardUtilization`
    -   The AI agent system prompt includes a full Session Category System section with routing rules for accurate revenue vs utilization reporting
    -   Payout calculations handled by `server/payout-calculator.ts` (`calculateCoachPayoutForBooking()`)
-   **Organization Media System:** A full multi-tenant media library allowing each org to upload and display images/videos across their public landing page.
    -   **Database:** `organization_media` table with fields: `id`, `organizationId`, `mediaType` (image/video), `section` (hero/training_showcase/facility/coaches/testimonials/results), `url`, `thumbnailUrl`, `caption`, `altText`, `orderIndex`, `isActive`, `uploadedBy`, `createdAt`, `updatedAt`.
    -   **File Uploads:** Multer disk storage to `public/uploads/`, served via `/uploads` static route. Validates file type (jpg/jpeg/png/gif/webp/mp4/mov/webm) and size limits (images: 10MB, videos: 100MB). Section limits enforced (hero: 3, training_showcase: 12, facility: 12, coaches: 20, testimonials: 20, results: 20).
    -   **API Routes:** `GET /api/org/media`, `POST /api/org/media` (upload), `PATCH /api/org/media/:id`, `DELETE /api/org/media/:id`, `POST /api/org/media/reorder`, `GET /api/public/org/:slug/media` (public).
    -   **Admin Media Library:** `/admin/media` page (`client/src/pages/admin-media.tsx`) with tabbed interface per section, drag-and-drop upload area, media cards with toggle/edit/delete actions, upload progress, empty states, and section limits display.
    -   **Public Landing Page Integration:** Hero media displays as a fullscreen background carousel with dark overlay and white text. Training showcase, facility, coaches, testimonials, and results sections render as `MediaGrid` or testimonial cards, only appearing when active media exists. A `MediaViewer` lightbox opens on click. All sections in `client/src/pages/org-landing.tsx` with helper components `MediaCarousel`, `MediaGrid`, `MediaViewer`.

-   **Team Training Prospecting Agent:** A backend admin agent for discovering and outreaching to local sports organizations for team training partnerships.
    -   **Database Tables:** `team_training_prospects` (lead data with confidence scoring and outreach status), `team_training_outreach_drafts` (generated email drafts with two-step approve/send flow), `team_training_outreach_events` (full audit log of all actions), `prospect_opt_outs` (DNC list with email-level opt-out tracking).
    -   **Prospect Fields:** orgId, prospectName, organizationType, sport, city, state, websiteUrl, contactName, contactRole, contactEmail, contactPhone, sourceUrl, confidenceScore (1-100), outreachStatus (New/Needs Review/Approved/Contacted/Replied/Not Interested/Do Not Contact), lastContactedAt, notes.
    -   **AI Research Service** (`server/team-training-prospecting.ts`): Uses OpenAI GPT-4o to discover local sports organizations based on org location/specialties. Scores leads, generates personalized outreach emails. Never invents contact details (emails are always null from AI, must be manually entered).
    -   **Safety Rules:** No auto-send ever. Two-step flow: generate draft → admin approves → admin sends. Pre-send checks: email required, not Do Not Contact, not opted out, 7-day cooldown enforced, body not empty, explicitly approved.
    -   **API Routes:** `GET /api/admin/team-training/prospects`, `GET /api/admin/team-training/stats`, `POST /api/admin/team-training/research`, `POST /api/admin/team-training/prospects`, `PATCH /api/admin/team-training/prospects/:id`, `DELETE /api/admin/team-training/prospects/:id`, `GET /api/admin/team-training/drafts`, `POST /api/admin/team-training/prospects/:id/generate-email`, `PATCH /api/admin/team-training/drafts/:id`, `POST /api/admin/team-training/drafts/:id/approve`, `POST /api/admin/team-training/drafts/:id/send`, `POST /api/admin/team-training/prospects/:id/mark-replied`, `POST /api/admin/team-training/prospects/:id/do-not-contact`, `GET /api/admin/team-training/events`.
    -   **Admin UI:** `/admin/team-training-leads` — dashboard stat cards (new leads, pending drafts, sent this week, replies, estimated pipeline with configurable per-prospect value), Leads tab with filter/search by sport/status/city, lead cards with confidence bar, Generate Email, Mark Replied, Do Not Contact, edit dialog, status change. Drafts tab with review/edit/approve/send flow.
    -   **Sidebar:** "Team Training Leads" link in a "Growth" section, visible to ADMIN role only.
    -   **Email Sending:** `sendTeamTrainingOutreachEmail` in `server/email.ts` using SendGrid, triggered only after explicit admin approval.
    -   **Audit Log:** Every research run, draft creation, approval, send, failure, replied, and DNC event is logged to `team_training_outreach_events`.

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