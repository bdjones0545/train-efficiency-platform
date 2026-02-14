# Efficiency Strength Training Scheduler

## Overview
A scheduling platform for Efficiency Strength Training LLC focused on sports performance and strength & conditioning. Clients can browse S&C coaches and book training sessions, coaches can manage availability and redeem completed sessions, and admins can manage the entire system.

## Tech Stack
- Frontend: React + TypeScript + Tailwind CSS + Shadcn UI (Vite)
- Backend: Express.js (TypeScript)
- Database: PostgreSQL with Drizzle ORM
- Auth: Replit Auth (OpenID Connect)
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

## API Routes
- GET /api/coaches - List active coaches (public)
- GET /api/coaches/:id - Single coach detail (public)
- GET /api/coaches/:id/slots - Available time slots (public, requires serviceId + weekStart query params)
- GET /api/services - List services (public)
- POST /api/bookings - Create booking (auth required)
- GET /api/bookings - Client's bookings (auth required)
- PATCH /api/bookings/:id/status - Update booking status (auth required)
- GET /api/coach/bookings - Coach's bookings (COACH/ADMIN)
- GET /api/coach/bookings/completed - Completed bookings (COACH/ADMIN)
- GET/POST/DELETE /api/coach/availability - Manage availability blocks (COACH/ADMIN)
- GET /api/coach/redemptions - Coach's redemptions (COACH/ADMIN)
- POST /api/redemptions - Redeem a completed session (COACH/ADMIN)
- GET /api/admin/users - All users (ADMIN)
- POST /api/admin/set-role - Set user role (ADMIN)
- POST /api/admin/services - Create service (ADMIN)
- GET /api/admin/bookings - All bookings (ADMIN)
- GET /api/admin/redemptions - All redemptions (ADMIN)

## Database
- PostgreSQL with Drizzle ORM
- Schema in shared/schema.ts
- Run `npm run db:push` to push schema changes
- Seed data creates 2 coaches, 3 services, and availability blocks

## Theme
- Dark mode default, vibrant green primary matching EST logo
- Logo integrated in landing page (nav, hero, footer) and sidebar
- Font: Inter

## Recent Changes
- Updated all copy and branding to focus on sports performance & strength & conditioning
- Theme redesign matching EST logo (green/black/white palette, dark mode default)
- Initial MVP build with full booking system
- Replit Auth integration
- Seed data for S&C coaches and services
