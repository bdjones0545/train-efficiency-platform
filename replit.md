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
-   **Role-Based Access Control (RBAC):** Implements `CLIENT`, `COACH`, and `ADMIN` roles to secure API endpoints and frontend features.
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
-   **Wallet & Transactions:** Coaches have a "Transactions" page detailing wallet credits, debits, and balances.
-   **Subscription Management:** Organizations can enable Stripe subscriptions, import products, and track them. Clients can view and manage their subscriptions with defined cancellation policies ("end_of_period" or "immediate").
-   **Subscription Scheduling:** Coaches can create recurring session schedules linked to subscription plans, auto-generating confirmed bookings. Group-type plans support additional configuration (max participants, age range, skill level) for public discovery.
-   **Subscription Revenue Analytics:** Business Plan page includes subscription revenue from Stripe invoices and integrates it into revenue charts.
-   **Subscription Coach Payout:** Subscription plans define a flat `coachPayPerSessionCents`, which overrides percentage-based payouts for subscription-linked sessions upon redemption.
-   **Subscription Session Allocation:** Plans define `sessionsPerWeek`. `sessionsRemaining` is tracked per subscriber and reset upon renewal via Stripe webhooks. Sessions are decremented upon redemption.

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