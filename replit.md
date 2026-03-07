# Train Efficiency Business Solutions

## Overview
Train Efficiency Business Solutions is a multi-tenant, white-label scheduling platform designed for strength and conditioning coaching businesses. It allows business owners to create their own branded platform, managing coaches, clients, and sessions. The platform aims to streamline operations for coaching businesses, enhance client engagement through easy booking, and provide robust administrative tools for business management and growth. The existing Efficiency Strength Training LLC operates as the inaugural organization.

The business vision is to become the leading scheduling and management solution for strength and conditioning professionals, empowering them to focus on coaching while the platform handles the complexities of scheduling, client management, and business analytics. Market potential lies in the growing demand for specialized coaching and the need for efficient, scalable business tools within this niche.

## User Preferences
I prefer iterative development with regular check-ins.
Please use clear and concise language in all explanations.
Focus on delivering functional features quickly.
I appreciate detailed explanations for complex architectural decisions.
Do not make changes to the folder `node_modules`.
Do not make changes to the file `.env`.

## System Architecture
The application follows a client-server architecture. The frontend is built with **React, TypeScript, Tailwind CSS, and Shadcn UI** using Vite, providing a modern and responsive user interface. The backend is an **Express.js** application written in TypeScript, handling API requests, business logic, and database interactions. **PostgreSQL** serves as the primary database, managed with **Drizzle ORM**. Authentication is handled via **Replit Auth (OpenID Connect)** for clients and a custom email/password login system for coaches, leveraging `bcryptjs` for secure password hashing. Client-side routing is managed by **Wouter**.

**Key Architectural Decisions:**
- **Multi-Tenancy:** Organizations are isolated via an `organization_id` on key tables (`coach_profiles`, `user_profiles`, `bookings`, `services`), allowing each business to have its own branded environment. New organizations register via a dedicated API endpoint, leading to a guided setup process for branding, services, and Stripe integration. Each organization has a dynamic landing page at `/org/{slug}`.
- **Role-Based Access Control (RBAC):** Distinct roles (CLIENT, COACH, ADMIN) are implemented, with API endpoints and frontend features gated based on the user's assigned role, ensuring data security and appropriate access levels.
- **UI/UX Design:** A dark mode theme is default, utilizing a vibrant green primary color consistent with the initial organization's branding. The Inter font is used throughout. Shadcn UI components provide a consistent and accessible design system.
- **Dynamic Content:** The platform supports dynamic content for organization branding (logo, taglines, colors) and service offerings, allowing white-label customization.
- **Payment Processing:** Integrates with Stripe for subscription management for organizations and individual session payments. Organizations can connect their own Stripe accounts for service payments, while platform subscriptions utilize the main platform's Stripe account.
- **Notification System:** Utilizes SendGrid for email notifications, including subscription status changes, password resets, and inactivity reminders.
- **AI Integration:** An AI Scheduling Assistant chatbot, powered by OpenAI's function calling capabilities, provides conversational interaction for clients and coaches, leveraging specific tools to manage schedules, bookings, and availability.

**Feature Specifications:**
- **Booking System:** Clients can browse coaches and services, view weekly calendar slots, and book sessions. Coaches manage their availability (recurring weekly blocks), view bookings, and redeem completed sessions. Overlap prevention is enforced.
- **Session Types:** Supports 1:1, semi-private (2-6 participants), and team training sessions. Semi-private sessions feature join/leave functionality and configurable capacity, age range, and skill levels.
- **Admin Tools:** Comprehensive admin dashboard for user management (including role assignment), service configuration, booking oversight, and CSV data export.
- **Team Training Management:** Features for requesting team training quotes, generating monthly Stripe invoices for team contracts, and automating team user creation upon payment. This includes contract-linked session scheduling and coach payout calculations based on contract value. Team quotes are now organization-aware: invoices are created using each organization's own connected Stripe account (with fallback to the platform's default Stripe if the org hasn't connected one). The `team_quotes` table includes an `organizationId` column to track which org's Stripe was used.
- **Email Color Customization:** Organizations can customize their email branding via the Admin Branding page (`/admin/branding`). The `emailPrimaryColor` (used for email header backgrounds, buttons, and detail box borders) and `emailSecondaryColor` (used for detail box backgrounds) fields on the `organizations` table allow per-org email styling. The branding page includes color pickers with hex input and a live email preview. Falls back to platform defaults (#16a34a green / #1a1a1a dark) when not set.
- **Business Analytics (Coach-Specific):** A "Business Plan" page provides coaches with analytics including client lists, session history, consistency scoring, revenue predictions (based on client consistency), and revenue history.
- **Client Import:** Admins can import client data via CSV, generating user accounts and sending invite emails for password creation.
- **Location Management:** Sessions can be assigned preset or custom locations.
- **Coach Toggle:** Admins/Coaches can toggle between viewing/editing different coach schedules and availability.
- **Wallet and Transactions:** A coach-specific "Transactions" page displays all wallet credits/debits and user balances.
- **Subscription Management:** Organizations can enable subscriptions via a toggle in the Configuration page. When enabled, admins can connect to their Stripe account to browse and import recurring subscription products. Selected products are stored in the `organization_subscription_plans` table. The `organizations` table has a `subscriptionsEnabled` boolean field to gate this feature. On the Coach Transactions page, when subscriptions are enabled, a "Stripe Subscriptions" toggle appears that, when turned on, adds a "Subscriptions" tab showing paid subscription invoices pulled directly from the org's connected Stripe account, including customer details, amounts, descriptions, and invoice links.
- **Subscription Scheduling:** When subscriptions are enabled, coaches see a "Schedule Subscription" button on the Coach Dashboard alongside the normal "Add Session" button. This opens a dedicated dialog for creating recurring session schedules tied to a subscription plan. Coaches select a subscription plan, search/select a client, pick a service type, choose training days of the week, set a start time and location, and specify how many weeks to generate sessions for. The system auto-creates confirmed bookings, skipping time conflicts. Schedules are stored in the `subscription_schedules` table and can be used to generate additional sessions later via the `/api/coach/subscription-schedules/:id/generate-sessions` endpoint.
- **Subscription Revenue Analytics:** The Business Plan page includes subscription revenue as its own category, pulled from Stripe subscription invoices only when subscriptions are enabled. A dedicated "Subscription Revenue" stat card (amber-styled) appears below the main stats when there is subscription revenue. In the "Revenue by Source (Actual)" chart, Subscriptions appears as its own amber bar alongside Wallet, Venmo, and Cash. Both the `stats.subscriptionRevenueCents` and `actualRevenue.subscriptionCents` fields are returned from the business plan API.
- **Client Subscription Checkout:** When an organization has subscriptions enabled with saved plans, clients see a "Subscription Plans" section on their Wallet page (between "Add Funds" and "Transaction History"). Each plan shows its name, description, and price with a "Subscribe" button. Clicking subscribe creates a Stripe Checkout Session in `subscription` mode using the org's connected Stripe account and redirects the client to Stripe to complete the subscription. On success, the client is redirected back to the wallet with a success toast. Endpoints: `GET /api/wallet/subscription-plans` (client-facing, returns active plans for user's org) and `POST /api/wallet/subscribe` (creates Stripe subscription checkout).

## External Dependencies
- **PostgreSQL:** Primary relational database for all application data.
- **Express.js:** Backend web framework.
- **React:** Frontend JavaScript library.
- **Tailwind CSS:** Utility-first CSS framework for styling.
- **Shadcn UI:** Reusable UI components.
- **Vite:** Frontend build tool.
- **Wouter:** Lightweight client-side router.
- **Drizzle ORM:** TypeScript ORM for PostgreSQL.
- **Replit Auth (OpenID Connect):** External authentication provider for clients.
- **Stripe:** Payment gateway for subscription management, session payments, and invoicing.
- **bcryptjs:** Library for hashing passwords.
- **SendGrid:** Email delivery service for notifications and transactional emails.
- **OpenAI API:** Powers the AI Scheduling Assistant chatbot for natural language processing and function calling.