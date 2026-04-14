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