# Train Efficiency Business Solutions

## Overview
Train Efficiency Business Solutions is a multi-tenant, white-label scheduling platform for strength and conditioning coaching businesses. It enables business owners to manage coaches, clients, and sessions under their own brand, streamlining operations, enhancing client engagement, and providing robust administrative tools. The platform aims to be the leading scheduling and management solution for strength and conditioning professionals, supporting their growth in a specialized coaching market.

## User Preferences
I prefer iterative development with regular check-ins.
Please use clear and concise language in all explanations.
Focus on delivering functional features quickly.
I appreciate detailed explanations for complex architectural decisions.
Do not make changes to the folder `node_modules`.
Do not make changes to the file `.env`.

## System Architecture
The application uses a client-server architecture. The frontend is built with **React, TypeScript, Tailwind CSS, and Shadcn UI** using Vite. The backend is an **Express.js** application (TypeScript) managing API requests and business logic, with **PostgreSQL** as the database, accessed via **Drizzle ORM**. Authentication uses **Replit Auth (OpenID Connect)** for clients and a custom email/password system (`bcryptjs`) for coaches. Client-side routing is handled by **Wouter**.

**Core Architectural Decisions:**
-   **Multi-Tenancy:** Each organization is isolated using an `organization_id` across key data tables, allowing for distinct branded environments and dynamic landing pages (`/org/{slug}`). New organizations undergo a guided setup.
-   **Role-Based Access Control (RBAC):** Implements `CLIENT`, `COACH`, `ADMIN`, and `STAFF` roles to secure API endpoints and frontend features.
-   **UI/UX Design:** Features a dark mode theme with a vibrant green primary color, Inter font, and consistent design using Shadcn UI components.
-   **Dynamic Content & White-Labeling:** Supports customization of organization branding (logo, taglines, colors) and service offerings.
-   **Payment Processing:** Integrates with **Stripe** for organizational subscriptions and individual session payments. Organizations can connect their own Stripe accounts.
-   **Notification System:** Uses **SendGrid** for various email notifications.
-   **AI Integration:** An AI Scheduling Assistant chatbot, powered by **OpenAI's** function calling, assists with conversational scheduling and booking.

**Key Feature Specifications:**
-   **Booking System:** Clients can book 1:1, semi-private (2-6 participants), and team training sessions based on coach availability. Coaches manage availability and redeem sessions. Semi-private sessions include join/leave functionality and configurable attributes.
-   **Admin Tools:** Dashboard for user management, service configuration, booking oversight, and CSV data export.
-   **Team Training Management:** Features for requesting quotes, generating Stripe invoices for contracts, and automating user creation. Coach payouts are calculated based on contract value.
-   **Email Customization:** Organizations can customize email primary and secondary colors via an admin branding page, with a live preview.
-   **Business Analytics (Coach-Specific):** Coaches access a "Business Plan" page with client lists, session history, consistency scoring, and revenue predictions/history.
-   **Client Import:** Admins can import client data via CSV, generating accounts and invite emails.
-   **Location Management:** Sessions and coach profiles can specify locations.
-   **Athletic Scheduling:** A multi-organizational, multi-program system allowing admins to create athletic programs with configurable teams per slot, training types, hours, and date range overrides. Programs are isolated and accessible via specific URLs.
-   **Coach Toggle:** Admins/Coaches can switch between viewing/editing different coach schedules.
-   **Wallet & Transactions:** Coaches have a "Transactions" page detailing wallet credits, debits, and balances. Admins can toggle whether coaches see the Transactions page in their sidebar via a `coachTransactionsVisible` setting on the `organizations` table (defaults to `true`), configurable in the admin Configuration page.
-   **Subscription Management:** Organizations can enable Stripe subscriptions, import products, and track them. Clients can view and manage their subscriptions with defined cancellation policies ("end_of_period" or "immediate").
-   **Subscription Scheduling:** Coaches can create recurring session schedules linked to subscription plans, auto-generating confirmed bookings. Group-type plans support additional configuration (max participants, age range, skill level) for public discovery.
-   **Subscription Revenue Analytics:** Business Plan page includes subscription revenue from Stripe invoices and integrates it into revenue charts.
-   **Subscription Coach Payout:** Subscription plans define a flat `coachPayPerSessionCents`, which overrides percentage-based payouts for subscription-linked sessions upon redemption.
-   **Subscription Session Allocation:** Plans define `sessionsPerWeek`. `sessionsRemaining` is tracked per subscriber and reset upon renewal via Stripe webhooks. Sessions are decremented upon redemption.

## Phase 1: TrainEfficiency Scheduling Agent Foundation

Phase 1 builds the core scheduling architecture and org-aware data structures for the future Scheduling Agent.

### Schema Extensions (Phase 1)
- **Roles:** Added `STAFF` to the `user_role` enum
- **Booking Statuses:** Added `RESCHEDULED` to the `booking_status` enum
- **Session Types:** Extended `session_type` enum with `SEMI_PRIVATE`, `TEAM_TRAINING`, `ASSESSMENT`, `RECOVERY`
- **`locations` table:** Org-scoped training zones/facilities with name, description, address, capacity, active fields
- **`blocked_times` table:** Coach-specific unavailable dates/times linked to coach profile and org
- **`bookings` enhancements:** Added `organization_id` and `location_id` columns for direct org-scoping

### New API Routes (Phase 1)
- `GET/POST/PATCH/DELETE /api/locations` — Org-scoped location management (ADMIN/COACH/STAFF only)
- `GET/POST/DELETE /api/blocked-times` — Org-scoped blocked time management
- `GET /api/scheduling/bookings` — Org-scoped booking list (all bookings filtered by org's coaches)
- `POST /api/scheduling/bookings` — Create booking with org validation
- `PATCH /api/scheduling/bookings/:id` — Update booking details
- `PATCH /api/scheduling/bookings/:id/status` — Update booking status
- `POST /api/scheduling-agent/chat` — Streaming scheduling agent chat (org-aware, SSE)
- `GET /api/scheduling-agent/context` — Org coaching context (coaches, services, locations)

### New Pages (Phase 1)
- `/scheduling` — Main scheduling page with:
  - List + Week calendar view toggle
  - Filters: coach, status, session type, location, search
  - Upcoming and past booking sections
  - Create/cancel/reschedule/complete/no-show booking actions
- `/scheduling/agent` — Scheduling Agent chat interface with:
  - Streaming AI chat (GPT) with org-scoped context
  - Suggested prompts for common scheduling tasks
  - Real-time context sidebar (coaches, services, locations count)

### Sidebar Navigation (Phase 1)
- New "Scheduling" section in sidebar for ADMIN/COACH/STAFF roles
- Links to /scheduling (Schedule) and /scheduling/agent (Scheduling Agent)

## Phase 2: Intelligent Scheduling Agent (Co-Pilot Mode)

Phase 2 adds full intelligence to the Scheduling Agent — natural language understanding, org-aware data reading, open slot calculation, insights, and confirmation-based execution.

### New Storage Methods (Phase 2)
- `getBookingsByDateRangeForOrg(orgId, start, end)` — org-wide bookings filtered by date range
- `findClientsWithNoBookingsSince(orgId, since)` — inactive client detection
- `getCoachUtilizationForOrg(orgId, start, end)` — per-coach booked vs. available minutes

### New Agent Tools (Phase 2)
- `get_org_schedule` — full org booking view for a date range (with optional coach filter)
- `find_inactive_clients` — clients with no booking in the last N days
- `get_coach_utilization` — utilization % per coach for a week or date range
- `identify_schedule_gaps` — open time blocks per coach where sessions could be added
- `reschedule_booking` — reschedule an existing booking to a new time (confirmation required)
- `find_client` — search a client by name to get their user ID before booking

### Co-Pilot System Prompt (Phase 2)
- Agent **always suggests before executing** bookings and reschedules
- Presents 2–3 numbered time options and waits for the user to choose
- Executes availability changes and insights immediately
- Professional, concise, operationally sharp tone (not robotic)
- Quick Action phrases ("Find openings", "Fill schedule", "Who hasn't booked?") are recognized and handled

### UI Enhancements (Phase 2)
- **Quick Actions grid** — 6 preset buttons on the empty chat screen (This Week's Schedule, Find Open Slots, Book a Session, Reschedule, Missing Clients, Coach Utilization)
- **Inline confirmation buttons** — "Yes, confirm" / "No, thanks" appear automatically when the agent presents options
- **Markdown-aware message rendering** — numbered lists, bullet points, and **bold** text rendered natively in chat bubbles
- **Refined sidebar** — "What I Can Do" capability list updated for Phase 2 tools
- **Auth fix** — chat route now correctly uses `req.user.claims?.sub` for Bearer token auth; frontend uses `getAuthHeaders()` utility (was using wrong localStorage key)

### Bug Fixes (Phase 2)
- Scheduling-agent chat route was using `req.user.id` instead of `req.user.claims?.sub` (correct for JWT Bearer token auth flow)
- Frontend was reading `localStorage.getItem("authToken")` instead of the correct key `"auth_token"` via `getAuthHeaders()`

## Phase 3: Operations Intelligence Engine

Phase 3 adds proactive ops intelligence, a waitlist system, agent action logging, automation level controls, and a redesigned 3-tab scheduling agent UI.

### New DB Tables (Phase 3)
- **`waitlist`** — Scheduling waitlist entries per org: clientId, coachId (preferred), sessionType, preferredDays/times, notes
- **`agent_action_log`** — Audit log of all agent-executed actions: actionType, description, payload (jsonb), executedAt, undone flag
- **`organizations.automation_level`** — INTEGER column (1=Co-Pilot, 2=Assisted, 3=Autonomous), default 1

### New Storage Methods (Phase 3)
- `getWaitlistByOrganization(orgId)` — Get all waitlist entries with client user data
- `addToWaitlist(entry)` / `removeFromWaitlist(id)` — Waitlist CRUD
- `logAgentAction(entry)` / `getAgentActionLog(orgId, limit)` / `undoAgentAction(id)` — Action log CRUD
- `getOrgAutomationLevel(orgId)` / `setOrgAutomationLevel(orgId, level)` — Automation setting management

### Operations Intelligence Engine (`server/scheduling-intelligence.ts`)
A dedicated module that computes a full org ops digest:
- Per-coach utilization (booked vs. available minutes, %)
- Week-over-week open slot count and revenue opportunity estimate
- Inactive client detection (no booking this week)
- Recent cancellations for backfill targeting
- Prioritized insight cards (high/medium/low priority) across categories: utilization, gaps, clients, revenue, waitlist, backfill

### New Agent Tools (Phase 3)
- `get_operations_digest` — Full ops intelligence summary (utilization, open slots, revenue, inactive clients, waitlist)
- `get_waitlist` — View all clients on the scheduling waitlist
- `add_to_waitlist` — Add a client to the waitlist with preferences
- `suggest_backfill` — Match waitlist clients to an open cancellation slot based on preferences

### New API Routes (Phase 3)
- `GET /api/scheduling/operations-digest` — Full org ops digest (ADMIN/COACH/STAFF)
- `GET/POST/DELETE /api/scheduling/waitlist` — Waitlist management
- `GET /api/scheduling/agent-action-log` — Agent action history (with ?limit param)
- `GET /api/scheduling/automation-level` — Get current org automation level
- `PATCH /api/scheduling/automation-level` — Set automation level (ADMIN only)

### UI Rebuild (Phase 3): 3-Tab Scheduling Agent
- **Chat tab** — Streaming AI chat with updated quick actions ("Operations Summary" + others)
- **Operations Feed tab** — Live dashboard showing:
  - 4 headline metric cards: Booked This Week, Open Slots, Open Revenue Est., Waitlist count
  - Prioritized insight cards with type badges (opportunity/warning/action/info) and action prompts
  - Coach utilization bar chart (all coaches)
  - Recent cancellations with Backfill button
  - Waitlist viewer with remove functionality
  - Agent activity log
- **Settings tab** — Automation level selector (3 options with descriptions), save button, engine feature list, tool listing

### Bug Fixes (Phase 3)
- Scheduling/bookings routes now use `req.user.claims?.sub ?? req.user.id` (was `req.user.id` only — broke Bearer token auth)
- Chat frontend now reads streaming `text/plain` response via `ReadableStream` reader (was calling `response.json()` on streaming response)
- `Save Automation Level` button no longer disabled when selecting same level (allows explicit re-save)

## Phase 4: Revenue Intelligence Engine (Complete)

Phase 4 adds a full Revenue Intelligence Engine to the Scheduling Agent — delivering LTV analytics, churn detection, upsell identification, and session package alerts.

### New File: `server/revenue-intelligence.ts`
Standalone revenue computation module with 5 exported functions:
- **`computeRevenueSummary(orgId)`** — Total revenue, last-30d revenue, MRR from active subscriptions, avg LTV, revenue by coach, revenue by time block (best hours), top clients, growth %
- **`computeChurnRisks(orgId)`** — At-risk clients based on inactivity (14+ days), session frequency drop, subscription cancellation signals, and low session balance
- **`computeUpsellOpportunities(orgId)`** — Clients booking ~1x/week who could add a 2nd session; 1-on-1 clients who could move to semi-private
- **`computeSessionPackageAlerts(orgId)`** — Clients with 0–2 sessions remaining on subscription plans or `cancelAtPeriodEnd: true`
- **`computeClientLTVs(orgId)`** — Full LTV breakdown: total spend, session count, monthly avg spend, first/last session date, retention days, churn risk level

### 5 New API Routes (in `server/routes.ts`)
All require `ADMIN | COACH | STAFF` role:
- `GET /api/scheduling/revenue-summary`
- `GET /api/scheduling/churn-risks`
- `GET /api/scheduling/upsell-opportunities`
- `GET /api/scheduling/client-ltv`
- `GET /api/scheduling/session-packages`

### 5 New Agent Tools (in `server/scheduling-assistant.ts`)
- **`get_revenue_summary`** — Full revenue snapshot for AI analysis
- **`get_churn_risks`** — At-risk client list with signals and suggested actions
- **`get_upsell_opportunities`** — Upgrade paths with estimated revenue lift
- **`get_client_value`** — Full LTV data for all clients
- **`get_session_packages`** — Session balance alerts for proactive renewal outreach

### Updated System Prompt
- New "Growth Mode" section with proactive revenue analysis instructions
- Quick action handling for revenue prompts ("Show revenue", "Churn risks", "Growth opportunities", etc.)
- Data presentation rules for dollar formatting and actionable insights

### UI Rebuild (Phase 4): 4-Tab Scheduling Agent
Added Revenue tab (4th tab) to `/scheduling/agent`:
- **Revenue metric cards**: Total Revenue (all-time), Last 30d + growth %, MRR (from active subscriptions), Avg Client LTV
- **Alert pills**: Clickable pills for churn risks, package alerts, upsell opportunities — scroll to relevant section
- **Revenue by Coach**: Horizontal bar chart with revenue, session count per coach
- **Top Clients**: Top 5 by all-time revenue with session count
- **Revenue by Time Block**: Hourly revenue heatmap for last 30 days
- **Churn Risks**: Per-client risk cards with signals, days since last booking, suggested action + "Ask agent" button
- **Session Package Alerts**: Critical/warning cards for low-balance subscriptions with "Reach out" agent prompt
- **Upsell Opportunities**: Actionable upgrade cards with estimated monthly revenue lift

Also added Revenue/Growth quick actions to the Chat tab home screen.

## External Dependencies
-   **PostgreSQL:** Primary database.
-   **Express.js:** Backend framework.
-   **React:** Frontend library.
-   **Tailwind CSS:** Styling framework.
-   **Shadcn UI:** UI component library.
-   **Vite:** Frontend build tool.
-   **Wouter:** Client-side router.
-   **Drizzle ORM:** TypeScript ORM.
-   **Replit Auth (OpenID Connect):** Client authentication.
-   **Stripe:** Payment gateway.
-   **bcryptjs:** Password hashing.
-   **SendGrid:** Email service.
-   **OpenAI API:** AI chatbot integration.