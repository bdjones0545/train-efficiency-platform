# Train Efficiency Business Solutions

## Overview
A multi-tenant white-label scheduling platform for strength & conditioning coaching businesses. Business owners sign up at the main landing page to get their own branded platform (at /org/{slug}), complete with their own coaches, clients, and sessions. The existing Efficiency Strength Training LLC operates as the first organization at /efficiencystrength.

## Tech Stack
- Frontend: React + TypeScript + Tailwind CSS + Shadcn UI (Vite)
- Backend: Express.js (TypeScript)
- Database: PostgreSQL with Drizzle ORM
- Auth: Replit Auth (OpenID Connect) + Coach email/password login
- Router: Wouter (client-side)

## Architecture
- `client/src/` - React frontend
- `server/` - Express backend
- `shared/` - Shared schema/types
- Auth handled via `server/replit_integrations/auth/`

## Roles
- CLIENT: Browse coaches, book sessions, manage bookings
- COACH: Set availability, manage sessions, redeem completed sessions
- ADMIN: Full access to manage users/coaches/services/pricing/reports

## Key Features
- Coach listing with profiles, specialties, bios
- Weekly calendar slot view for booking
- Overlap prevention for double-booking
- Coach dashboard with session management
- Availability manager (recurring weekly blocks)
- Redemption system for completed sessions
- Admin dashboard with user management, services, bookings, CSV export
- Semi-private group sessions (2-6 participants) with join/leave functionality
- Open Sessions page for clients to browse and join available group sessions

## Multi-Tenant Architecture
- `organizations` table: id, name, slug, logoUrl, ownerUserId, ownerEmail, tagline, tagline2, primaryColor, secondaryColor, locations, createdAt
- `coach_profiles.organization_id` and `user_profiles.organization_id` link users/coaches to their organization
- POST /api/organizations/register - Business owner sign-up (creates org + admin + coach profile)
- GET /api/organizations/:slug - Get organization info (public)
- GET /api/organizations/:slug/coaches - Get coaches for an organization (public)
- Each org gets a landing page at /org/{slug} (dynamic OrgLandingPage component)
- Efficiency Strength Training is the default org (slug: "efficiencystrength", id: "org-est")
- The main landing page (/) is the Train Efficiency Business Solutions marketing page for business owners

## API Routes
- POST /api/coach/login - Coach email/password login (public)
- GET /api/coaches - List active coaches (public)
- GET /api/coaches/:id - Single coach detail (public)
- GET /api/coaches/:id/slots - Available time slots (public, requires serviceId + weekStart query params)
- GET /api/services - List services (public)
- POST /api/bookings - Create booking (auth required)
- GET /api/bookings - Client's bookings (auth required)
- PATCH /api/bookings/:id/status - Update booking status (auth required)
- GET /api/coach/bookings - Coach's bookings (COACH/ADMIN)
- POST /api/coach/bookings - Coach creates booking (COACH/ADMIN)
- GET /api/coach/clients/search - Search existing clients (COACH/ADMIN)
- GET /api/coach/bookings/completed - Completed bookings (COACH/ADMIN)
- GET/POST/DELETE /api/coach/availability - Manage availability blocks (COACH/ADMIN)
- GET /api/coach/redemptions - Coach's redemptions (COACH/ADMIN)
- POST /api/redemptions - Redeem a completed session (COACH/ADMIN)
- GET /api/admin/users - All users (ADMIN)
- POST /api/admin/set-role - Set user role (ADMIN)
- POST /api/admin/services - Create service (ADMIN)
- POST /api/admin/coaches - Add new coach with credentials and welcome email (ADMIN)
- GET /api/sessions/open - List open semi-private sessions (public)
- GET /api/bookings/:id/participants - Get session participants (public)
- POST /api/bookings/:id/join - Join a semi-private session (auth required)
- DELETE /api/bookings/:id/leave - Leave a semi-private session (auth required)
- GET /api/admin/bookings - All bookings (ADMIN)
- GET /api/admin/redemptions - All redemptions (ADMIN)
- GET /api/admin/cashouts - All cashout requests with coach names (ADMIN)
- PATCH /api/admin/cashouts/:id/status - Update cashout status to PAID or DENIED (ADMIN)

## Database
- PostgreSQL with Drizzle ORM
- Schema in shared/schema.ts
- Run `npm run db:push` to push schema changes
- Seed data creates 2 coaches, 3 services, and availability blocks

## Theme
- Dark mode default, vibrant green primary matching EST logo
- Logo integrated in landing page (nav, hero, footer) and sidebar
- Font: Inter

## Coach Credentials
- coach_profiles table has coach_email and password_hash columns for email/password login
- Coach login modal on landing page (POST /api/coach/login)
- After login, coaches are redirected to /coach dashboard
- Passwords hashed with bcryptjs
- Public API endpoints strip passwordHash from responses

## Admin Configuration
- Configuration page (/admin/configuration): admin-only page for managing training options, locations, services
- Branding page (/admin/branding): admin-only page for customizing org logo, URL slug, taglines (1 & 2), with save+preview
- Stripe page (/admin/stripe): admin-only page for connecting org's own Stripe account (publishable + secret keys), with connection status badge and disconnect option; secret key never exposed after save
  - Add new coaches with name, email, password, bio, specialties
  - Per-coach payout percentage: each coach card shows editable payout % (edit icon inline)
  - payoutPercentage column on coach_profiles table (nullable integer, null = use default)
  - Add/edit training options (services) with name, description, duration, price, active toggle
  - Session price updates sync with Stripe (creates/updates Stripe products and prices)
  - Default coach payout percentage (applies to coaches without custom %, default 50%, owner always 100%)
  - stripeProductId and stripePriceId columns added to services table
  - app_settings table stores key-value configuration (e.g. coach_payout_percentage)
  - Payout priority: per-coach payoutPercentage > global default > 50%
  - API: GET/PUT /api/admin/settings, PATCH /api/admin/services/:id, PATCH /api/admin/coaches/:id/payout (ADMIN)
  - "Configuration > Options" sidebar section visible only to ADMIN users

## Recent Changes
- Client Team Training request page (/team-training): form for clients to request team training quotes
  - Fields: team name, sport, number of athletes, location, goals, preferred schedule, contact info, additional notes
  - POST /api/team-training-request - Sends branded email with all details to Bryan (auth required)
  - "Team Training" link in client sidebar Browse section
  - Contact name/email pre-filled from logged-in user
  - Success screen shown after submission
- Team contract-linked session scheduling
  - teamQuoteProgramId column on bookings table links sessions to paid team contracts
  - GET /api/coach/team-contracts - List active (paid) team programs (COACH/ADMIN)
  - AddSessionDialog shows team contract selector when Team Training service is selected
  - Selecting a paid contract auto-fills team name and shows estimated coach payout
  - Redemption: sessions linked to a contract calculate per-session value (monthly total / sessions per month) and pay coach 50% (owner gets 100%)
- Team Quotes feature (/coach/team-quotes): generate team training quotes with monthly Stripe invoicing
  - team_quotes table: teamName, numberOfAthletes, costPerAthleteCents, trainingType (STRENGTH/SPEED), frequency, durationWeeks (stores months), coachEmail, totalCents (monthly amount), status, stripeInvoiceId/Url, currentMonth, totalMonths
  - POST /api/coach/team-quotes - Create quote, generate first month's Stripe invoice, email to coach (COACH/ADMIN)
  - GET /api/coach/team-quotes - List quotes (coach sees own, admin sees all) (COACH/ADMIN)
  - Form: team name, # athletes, cost/athlete/month, training type, frequency, program duration (months), email
  - Monthly billing: generates one Stripe invoice per month (send_invoice collection method, 30 days due)
  - Auto-renewal: when a monthly invoice is paid (via Stripe webhook), the next month's invoice is automatically generated and sent
  - Automatic team user creation: when first month's invoice is paid, a user record is created (teamName + "Team Training", coach email) so the team is immediately searchable and schedulable
  - Each month creates a separate team_quote record with currentMonth tracking (e.g., Month 2 of 6)
  - Sends branded email with invoice link via SendGrid (includes month X of Y info)
  - Quote history grouped by team with payment progress bar and individual month invoice rows
  - "Team Quotes" link added to coach sidebar under Coach Tools
- Payment method tracking on sessions and revenue analytics
  - paymentMethod column (WALLET, VENMO, CASH) added to bookings table
  - Payment method selector in Edit Session dialog
  - "By Source" tab on Business Plan revenue chart showing revenue breakdown by payment method
  - Color-coded bars (blue=Wallet, purple=Venmo, green=Cash, gray=Not Set) with percentages
  - Backend: PATCH /api/coach/bookings/:id accepts paymentMethod field
  - Business plan API includes paymentMethod in session data
- Business Plan page (/coach/business-plan): coach-specific business analytics
  - New "Business Plan" sidebar section for COACH/ADMIN roles
  - Coach selector to view any coach's business plan (admin only; coaches see their own)
  - Client list with session history, consistency scoring, and last session indicator
  - Revenue prediction algorithm using weighted 3-month session consistency per client
  - Revenue history chart (last 6 months) with predicted next month bar
  - Stats: total clients, total sessions, total revenue, predicted monthly revenue
  - API: GET /api/coach/business-plan/:coachId (COACH own only, ADMIN any)
  - Auth: coaches restricted to own profile; admins can view any coach
- Weekly inactivity reminder emails: automatic emails to users who haven't signed in for 7+ days
  - last_sign_in_at and weekly_reminder_enabled columns added to users table
  - lastSignInAt updated on every login (client login, coach login, Replit Auth)
  - New registrations set lastSignInAt to registration time
  - Existing users backfilled with lastSignInAt = createdAt
  - Daily background job checks for inactive users and sends reminder emails via SendGrid
  - Email template with EST branding encouraging users to schedule a session
  - server/weekly-reminder.ts contains the job logic
  - sendWeeklyReminderEmail function in server/email.ts
- BLHS Athletic Scheduling page (/athletic): public scheduling page for Bluffton High School athletic teams
  - Daily calendar view (4 PM – 8 PM) with coach-dashboard-style timeline
  - Max 2 teams per 1-hour time slot, enforced on backend
  - Dialog prompt asks "What team are you scheduling?" on slot click
  - Public API: GET /api/athletic/bookings?date=, POST /api/athletic/bookings, DELETE /api/athletic/bookings/:id
  - athletic_bookings table: id, date, time_slot, team_name, booked_by, created_at
  - "BLHS Athletic" tab added to landing page navigation
- Location field for session scheduling: coaches select from preset locations or enter custom
  - Preset locations: Bluffton High School, Oscar Frazier Park, PickUp USA Fitness, Sweet Grass Fitness, Coursen Tate Park, Robert Smalls International Academy
  - Custom "Other" option with manual text input
  - Location displayed on coach dashboard calendar, My Bookings page, and Open Sessions page
  - Location editable in Edit Session dialog
  - location column added to bookings table
- Coach toggle feature: coaches can switch between viewing/editing any coach's schedule and availability
  - Coach selector dropdown on dashboard and availability manager pages (visible when multiple coaches exist)
  - Backend endpoints accept optional coachId param: GET /api/coach/bookings, GET/POST /api/coach/availability, POST /api/coach/bookings, GET /api/coach/redemptions
  - AddSessionDialog accepts coachId prop to create sessions for selected coach
- Daily calendar view on coach dashboard: vertical timeline (5 AM–10 PM), availability shading, booking blocks with inline status actions (complete/no-show/cancel) and redemption buttons
  - Date navigation with prev/next day buttons and date picker
  - Click empty time slots to prefill AddSessionDialog with selected date/time
  - Day stats cards (total, confirmed, pending, completed)
  - AddSessionDialog enhanced with initialDate/initialTime/triggerButton props
- Coach Transactions page (/coach/transactions): view all wallet transactions and user balances
  - Summary cards: total deposits, total payments, users with non-zero balance
  - Transactions tab: searchable, filterable list of all wallet credits/debits with user info
  - User Balances tab: searchable list of all users with their wallet balance
  - API: GET /api/coach/transactions, GET /api/coach/user-balances (COACH/ADMIN)
  - "Transactions" link added to coach sidebar navigation
- Enhanced semi-private participant management in AddSessionDialog and EditSessionDialog
  - Coaches can search and select existing users to add to group sessions (linked by userId)
  - Coaches can also type walk-in names for unregistered participants
  - Each participant shown with "User" or "Walk-in" badge, removable
  - Participant count displayed (X/6), max 6 enforced in UI and backend
  - Backend accepts `participants` array with {type, userId, displayName} objects
  - Server-side deduplication prevents duplicate participants
  - Legacy `participantNames` string array still supported for backward compatibility
  - EditSessionDialog shows current participants with add/remove functionality for semi-private sessions
  - API: POST /api/coach/bookings/:id/add-participant, DELETE /api/coach/bookings/:id/participants/:participantId (COACH/ADMIN)
- Semi-private group sessions: booking_participants table, maxParticipants/ageRange/skillLevel columns on bookings
  - Coaches schedule semi-private sessions with group description, age range, skill level, and configurable max participants
  - Open Sessions page (/sessions) for clients to browse and join group sessions with age range/skill level badges
  - Join/leave API endpoints with dynamic capacity enforcement (configurable per session, default 6)
  - Participant display on coach dashboard and booking cards
  - Session cloning from EditSessionDialog (clone button) with weekly/biweekly/daily/specific days options
- Services updated: 1:1 60min ($70), 1:1 30min ($40), Semi-Private ($35), Team Training (by quote), Free Intro Session (30 min, one per user)
  - Team Training shows "Quoted Price" instead of $0.00
  - Free Intro Session limited to one per user (enforced backend + hidden from dropdown after use)
  - GET /api/free-session-status - Check if user has used free session (auth required)
- AI Scheduling Assistant chatbot (floating widget, bottom-right)
  - POST /api/chat - Streaming SSE endpoint for chat messages
  - OpenAI function calling with tools: list_coaches, list_services, get_available_slots, book_session, get_my_bookings, cancel_booking, get_coach_schedule, set_availability, get_availability, delete_availability, coach_create_session
  - Role-aware system prompt (CLIENT vs COACH/ADMIN)
  - Streams responses via Server-Sent Events
  - Chat widget component at client/src/components/chat-widget.tsx
  - Backend logic in server/scheduling-assistant.ts
- Coach-initiated session scheduling: coaches can add sessions from dashboard with client name, service, date/time
  - POST /api/coach/bookings - Coach creates booking (supports clientId or clientFirstName/clientLastName)
  - GET /api/coach/clients/search - Search existing clients by name/email
  - Walk-in clients auto-created in users table when not found
- Added coach email/password login system with sign-in modal on landing page
- Added Bryan Jones and Hunter Thaxton as coaches with credentials
- Coach profile editing (bio, specialties, photo, timezone)
- Updated all copy and branding to focus on sports performance & strength & conditioning
- Theme redesign matching EST logo (green/black/white palette, dark mode default)
- Initial MVP build with full booking system
- Replit Auth integration
- Seed data for S&C coaches and services
