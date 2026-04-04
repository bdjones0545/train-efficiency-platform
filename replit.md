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