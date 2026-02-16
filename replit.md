# Efficiency Strength Training Scheduler

## Overview
A scheduling platform for Efficiency Strength Training LLC focused on sports performance and strength & conditioning. Clients can browse S&C coaches and book training sessions, coaches can manage availability and redeem completed sessions, and admins can manage the entire system.

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

## Recent Changes
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
- Enhanced semi-private participant management in AddSessionDialog
  - Coaches can search and select existing users to add to group sessions (linked by userId)
  - Coaches can also type walk-in names for unregistered participants
  - Each participant shown with "User" or "Walk-in" badge, removable
  - Participant count displayed (X/6), max 6 enforced in UI and backend
  - Backend accepts `participants` array with {type, userId, displayName} objects
  - Server-side deduplication prevents duplicate participants
  - Legacy `participantNames` string array still supported for backward compatibility
- Semi-private group sessions: booking_participants table, maxParticipants column on bookings
  - Coaches schedule semi-private sessions with group description (auto-detects from service name)
  - Open Sessions page (/sessions) for clients to browse and join group sessions
  - Join/leave API endpoints with capacity enforcement (max 6)
  - Participant display on coach dashboard and booking cards
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
