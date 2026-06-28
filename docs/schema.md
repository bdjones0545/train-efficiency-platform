# Database Schema Reference

**Document Type:** Implementation
**Verification Status:** Verified Against Source
**Primary Source:** `shared/schema.ts` (5,334 lines), `shared/models/auth.ts`, `shared/models/chat.ts`
**Schema Confirmed By:** `drizzle.config.ts` (`out: "./drizzle"`, `schema: "./shared/schema.ts"`)
**Generated:** 2026-06-28
**Total Tables (Drizzle-defined):** 208
**Additional Tables (raw SQL, not in Drizzle):** ~20 (documented in Appendix A)

---

## Table of Contents

1. [Authentication & Sessions](#1-authentication--sessions)
2. [Core Organization & Tenancy](#2-core-organization--tenancy)
3. [Scheduling & Services](#3-scheduling--services)
4. [Financial & Payments](#4-financial--payments)
5. [Athletic Programs (Group/Team Sessions)](#5-athletic-programs-groupteam-sessions)
6. [Personal Records (PR Tracking)](#6-personal-records-pr-tracking)
7. [Athlete Intelligence & Profiles](#7-athlete-intelligence--profiles)
8. [Persistent Athlete Intelligence Layer (PAIL)](#8-persistent-athlete-intelligence-layer-pail)
9. [Workout Builder & Programs](#9-workout-builder--programs)
10. [Nutrition Education](#10-nutrition-education)
11. [Education Builder & Adaptive Learning](#11-education-builder--adaptive-learning)
12. [Parent / Guardian Portal](#12-parent--guardian-portal)
13. [Communications & Notifications](#13-communications--notifications)
14. [Lead Capture & Intelligence](#14-lead-capture--intelligence)
15. [Team Training Prospecting & Deals](#15-team-training-prospecting--deals)
16. [Email / Gmail Agent Layer](#16-email--gmail-agent-layer)
17. [Revenue Intelligence](#17-revenue-intelligence)
18. [AI Governance & Infrastructure](#18-ai-governance--infrastructure)
19. [Workflow Orchestration](#19-workflow-orchestration)
20. [CEO Heartbeat & Agent Orchestration](#20-ceo-heartbeat--agent-orchestration)
21. [AI Workforce Operations](#21-ai-workforce-operations)
22. [Agent Marketplace (Phases 6–9)](#22-agent-marketplace-phases-69)
23. [Beta Program Infrastructure](#23-beta-program-infrastructure)
24. [Attendance Tracker](#24-attendance-tracker)
25. [Adaptive Workflow Engine (Athlete-Facing)](#25-adaptive-workflow-engine-athlete-facing)
26. [Communication Automation Engine](#26-communication-automation-engine)
27. [Org AI Integrations & Settings](#27-org-ai-integrations--settings)
28. [Software Improvement Tasks](#28-software-improvement-tasks)
29. [Agent Quality & Trust](#29-agent-quality--trust)
30. [Chat (TrainChat)](#30-chat-trainchat)
31. [Appendix A: Tables Created Outside Drizzle Schema](#appendix-a-tables-created-outside-drizzle-schema)
32. [Architecture Discrepancies](#architecture-discrepancies)
33. [Recommended CLAUDE.md Updates](#recommended-claudemd-updates)
34. [Files Reviewed](#files-reviewed)
35. [Confidence Assessment](#confidence-assessment)

---

## Primary Key Convention

Two patterns coexist in this schema:

| Pattern | Example | Notes |
|---------|---------|-------|
| `varchar("id").primaryKey().default(sql\`gen_random_uuid()\`)` | Most older tables | Drizzle `varchar` type |
| `text("id").primaryKey().$defaultFn(() => crypto.randomUUID())` | Newer tables (Phase 3+) | Drizzle `text` type |

Both produce UUID primary keys. The difference is cosmetic at the database level.

---

## 1. Authentication & Sessions

**Source:** `shared/models/auth.ts`

### `sessions`
Mandatory Replit Auth session storage. Do not drop or rename.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `sid` | varchar | PRIMARY KEY | Session ID |
| `sess` | jsonb | NOT NULL | Full session payload |
| `expire` | timestamp | NOT NULL | Indexed via `IDX_session_expire` |

### `users`
Mandatory Replit Auth user storage. Core identity record. Do not drop or rename.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | varchar | PK, `gen_random_uuid()` | |
| `email` | varchar | UNIQUE | |
| `first_name` | varchar | | |
| `last_name` | varchar | | |
| `password_hash` | text | | bcryptjs hash for coach auth |
| `profile_image_url` | varchar | | |
| `phone` | varchar | | |
| `notes` | text | | |
| `balance_cents` | integer | NOT NULL, default 0 | Wallet balance |
| `stripe_customer_id` | varchar | | |
| `last_sign_in_at` | timestamp | | |
| `weekly_reminder_enabled` | boolean | NOT NULL, default true | |
| `last_reminder_sent_at` | timestamp | | |
| `password_reset_token` | varchar | | |
| `password_reset_token_expires` | timestamp | | |
| `unsubscribe_token` | varchar | UNIQUE | |
| `notification_preferences` | jsonb | | |
| `sms_opt_in` | boolean | NOT NULL, default false | |
| `sms_opt_in_at` | timestamp | | |
| `sms_opt_out_at` | timestamp | | |
| `sms_consent_source` | varchar | | |
| `created_at` | timestamp | default now | |
| `updated_at` | timestamp | default now | |

**Types exported:** `User`, `UpsertUser`

### `password_reset_tokens`
Secondary password-reset token store (complementary to `users.password_reset_token`).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | varchar | PK | |
| `email` | varchar | NOT NULL | |
| `user_id` | varchar | | FK implied to `users` |
| `coach_profile_id` | varchar | | FK implied to `coach_profiles` |
| `token_hash` | text | NOT NULL | |
| `expires_at` | timestamp | NOT NULL | |
| `used_at` | timestamp | | |
| `created_at` | timestamp | default now | |

---

## 2. Core Organization & Tenancy

**Source:** `shared/schema.ts` lines 1–400 (approx)

### `organizations`
Root multi-tenant record. Every other table scopes data by `org_id`.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | varchar | PK | |
| `name` | varchar | NOT NULL | Brand name |
| `slug` | varchar | UNIQUE | URL identifier |
| `logo_url` | text | | White-label logo |
| `tagline` | text | | Brand tagline |
| `primary_color` | varchar | | Hex color |
| `accent_color` | varchar | | Hex color |
| `website` | varchar | | |
| `email` | varchar | | Contact email |
| `phone` | varchar | | |
| `address` | text | | |
| `description` | text | | |
| `hero_image_url` | text | | Landing page hero |
| `about_image_url` | text | | |
| `sport_focus` | varchar | | Primary sport type |
| `custom_domain` | varchar | | |
| `stripe_account_id` | varchar | | Connected Stripe account |
| `stripe_onboarding_complete` | boolean | default false | |
| `created_at` | timestamp | default now | |
| `updated_at` | timestamp | default now | |

### `organization_subscription_plans`
Subscription plan definitions per organization (what plans the org offers to clients).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | varchar | PK | |
| `org_id` | varchar | NOT NULL | |
| `name` | varchar | NOT NULL | |
| `description` | text | | |
| `price_cents` | integer | NOT NULL | Monthly price |
| `interval` | varchar | NOT NULL | month/year |
| `session_credits` | integer | | Sessions included |
| `features` | jsonb | default [] | |
| `is_active` | boolean | default true | |
| `stripe_price_id` | varchar | | |
| `created_at` | timestamp | default now | |

### `user_subscriptions`
Active client subscriptions to an org's plan.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | varchar | PK | |
| `user_id` | varchar | NOT NULL | |
| `org_id` | varchar | NOT NULL | |
| `plan_id` | varchar | NOT NULL | → `organization_subscription_plans` |
| `status` | varchar | NOT NULL | active/paused/cancelled |
| `stripe_subscription_id` | varchar | | |
| `current_period_start` | timestamp | | |
| `current_period_end` | timestamp | | |
| `created_at` | timestamp | default now | |
| `updated_at` | timestamp | default now | |

### `subscription_schedules`
Scheduled plan changes and trials.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | varchar | PK | |
| `user_id` | varchar | NOT NULL | |
| `org_id` | varchar | NOT NULL | |
| `subscription_id` | varchar | | |
| `scheduled_plan_id` | varchar | | |
| `effective_date` | timestamp | | |
| `action` | varchar | | upgrade/downgrade/cancel |
| `status` | varchar | default pending | |
| `created_at` | timestamp | default now | |

### `user_profiles`
Extended profile data for every platform user; holds the `role` and `organization_id` that auth guards depend on.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | varchar | PK | |
| `user_id` | varchar | NOT NULL | → `users.id` |
| `organization_id` | varchar | | Tenant scope |
| `role` | varchar | | CLIENT/COACH/ADMIN/STAFF |
| `bio` | text | | |
| `specializations` | jsonb | | |
| `certifications` | jsonb | | |
| `years_experience` | integer | | |
| `profile_complete` | boolean | default false | |
| `onboarding_step` | integer | default 0 | |
| `created_at` | timestamp | default now | |
| `updated_at` | timestamp | default now | |

> **Critical:** Auth guards (`privilegedOnly`, role checks) read `role` and `organization_id` from `user_profiles`, not from `users`. The `users` table has no `organization_id` column.

### `coach_profiles`
Detailed coach record used for scheduling, availability, and service assignment.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | varchar | PK | |
| `user_id` | varchar | | → `users.id` (null for invite-only coaches) |
| `org_id` | varchar | NOT NULL | |
| `email` | varchar | NOT NULL | |
| `first_name` | varchar | | |
| `last_name` | varchar | | |
| `title` | varchar | | Job title |
| `bio` | text | | |
| `specializations` | jsonb | | |
| `profile_image_url` | varchar | | |
| `is_active` | boolean | default true | |
| `invite_token` | varchar | | |
| `invite_email` | varchar | | |
| `invite_expires_at` | timestamp | | |
| `created_at` | timestamp | default now | |
| `updated_at` | timestamp | default now | |

### `app_settings`
Per-org key/value settings store.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | varchar | PK | |
| `org_id` | varchar | NOT NULL | |
| `key` | varchar | NOT NULL | Setting name |
| `value` | text | | Setting value |
| `created_at` | timestamp | default now | |
| `updated_at` | timestamp | default now | |

### `org_users`, `org_memberships`, `org_sessions`
Multi-org membership tables (secondary to `user_profiles`).

**`org_users`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `user_id` | varchar NOT NULL | |
| `role` | varchar | |
| `created_at` | timestamp | |

**`org_memberships`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `user_id` | varchar NOT NULL | |
| `status` | varchar | pending/active/suspended |
| `joined_at` | timestamp | |
| `created_at` | timestamp | |

**`org_sessions`**
Server-side org-scoped sessions (distinct from Replit `sessions`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `user_id` | varchar NOT NULL | |
| `token` | text | |
| `expires_at` | timestamp | |
| `created_at` | timestamp | |

### `user_org_preferences`
Per-user, per-org UI preferences (theme, notification settings, etc.).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `user_id` | varchar NOT NULL | |
| `org_id` | varchar NOT NULL | |
| `preferences` | jsonb | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

---

## 3. Scheduling & Services

### `services`
Bookable service definitions per org (e.g., "1-Hour Personal Training").

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | varchar | PK | |
| `org_id` | varchar | NOT NULL | |
| `name` | varchar | NOT NULL | |
| `description` | text | | |
| `duration_minutes` | integer | NOT NULL | |
| `price_cents` | integer | NOT NULL | |
| `max_participants` | integer | default 1 | |
| `coach_id` | varchar | | → `coach_profiles` |
| `location_id` | varchar | | |
| `is_active` | boolean | default true | |
| `created_at` | timestamp | default now | |
| `updated_at` | timestamp | default now | |

### `availability_blocks`
Coach availability windows for booking.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `coach_id` | varchar NOT NULL | |
| `day_of_week` | integer | 0=Sun, 6=Sat |
| `start_time` | varchar | HH:MM |
| `end_time` | varchar | HH:MM |
| `is_recurring` | boolean | |
| `specific_date` | timestamp | For one-off blocks |
| `created_at` | timestamp | |

### `locations`
Physical or virtual session locations.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `name` | varchar NOT NULL | |
| `address` | text | |
| `is_virtual` | boolean | |
| `meeting_url` | text | |
| `created_at` | timestamp | |

### `blocked_times`
Coach time blocks (vacation, admin time, etc.).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `coach_id` | varchar NOT NULL | |
| `start_at` | timestamp NOT NULL | |
| `end_at` | timestamp NOT NULL | |
| `reason` | text | |
| `created_at` | timestamp | |

### `bookings`
Core booking record linking client, coach, service, and time.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | varchar | PK | |
| `org_id` | varchar | NOT NULL | |
| `user_id` | varchar | NOT NULL | Client |
| `coach_id` | varchar | | → `coach_profiles` |
| `service_id` | varchar | NOT NULL | |
| `location_id` | varchar | | |
| `start_at` | timestamp | NOT NULL | |
| `end_at` | timestamp | NOT NULL | |
| `booking_status` | varchar | NOT NULL | PENDING/CONFIRMED/CANCELLED/COMPLETED |
| `price_cents` | integer | | |
| `notes` | text | | |
| `source_outcome_id` | varchar | | → `agent_communication_outcomes` (revenue attribution FK) |
| `created_at` | timestamp | default now | |
| `updated_at` | timestamp | default now | |

> **Booking status enum is uppercase:** `PENDING`, `CONFIRMED`, `CANCELLED`, `COMPLETED`. Use uppercase string values when inserting via raw SQL.

### `booking_participants`
Additional participants on a group booking.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `booking_id` | varchar NOT NULL | |
| `user_id` | varchar NOT NULL | |
| `status` | varchar | confirmed/cancelled |
| `created_at` | timestamp | |

### `redemptions`
Credit redemption records (session packages, etc.).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `user_id` | varchar NOT NULL | |
| `org_id` | varchar NOT NULL | |
| `booking_id` | varchar | |
| `credits_used` | integer NOT NULL | |
| `created_at` | timestamp | |

### `waitlist`
Booking waitlist when capacity is full.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `user_id` | varchar NOT NULL | |
| `service_id` | varchar | |
| `requested_date` | timestamp | |
| `status` | varchar | waiting/offered/expired/cancelled |
| `created_at` | timestamp | |

### Scheduling Phase 2 Tables

#### `athlete_scheduling_profiles`
Per-athlete scheduling intelligence (preferred times, capacity, recurrence rules).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `preferred_days` | jsonb | |
| `preferred_times` | jsonb | |
| `capacity_hours_per_week` | integer | |
| `notes` | text | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `session_attendance`
Attendance tracking per booking.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `booking_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `status` | varchar | present/absent/late/excused |
| `checked_in_at` | timestamp | |
| `notes` | text | |
| `created_at` | timestamp | |

#### `session_recurrence_rules`
Recurrence definitions for repeating bookings.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `booking_id` | varchar NOT NULL | |
| `frequency` | varchar | daily/weekly/biweekly/monthly |
| `interval` | integer | |
| `days_of_week` | jsonb | |
| `end_date` | timestamp | |
| `max_occurrences` | integer | |
| `created_at` | timestamp | |

#### `waitlist_holds`
Time-limited slot holds during checkout.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `service_id` | varchar NOT NULL | |
| `slot_start` | timestamp NOT NULL | |
| `slot_end` | timestamp NOT NULL | |
| `expires_at` | timestamp NOT NULL | |
| `status` | varchar | held/released/converted |
| `created_at` | timestamp | |

---

## 4. Financial & Payments

### `credit_ledger_events`
Double-entry credit ledger (session credits, package credits).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `user_id` | varchar NOT NULL | |
| `org_id` | varchar NOT NULL | |
| `type` | varchar NOT NULL | purchase/use/refund/adjustment/expiry |
| `amount` | integer NOT NULL | Positive = credit, negative = debit |
| `booking_id` | varchar | |
| `description` | text | |
| `created_at` | timestamp | |

### `revenue_ledger_events`
Financial revenue ledger — source of truth for money movement.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `type` | varchar NOT NULL | booking_payment/refund/subscription/cashout/adjustment |
| `amount_cents` | integer NOT NULL | |
| `booking_id` | varchar | |
| `user_id` | varchar | |
| `stripe_payment_intent_id` | varchar | |
| `description` | text | |
| `recorded_at` | timestamp | |
| `created_at` | timestamp | |

### `financial_event_failures`
Failed payment and ledger event log.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `event_type` | varchar NOT NULL | |
| `error_message` | text | |
| `payload` | jsonb | |
| `created_at` | timestamp | |

### `financial_closeouts`
Period-end financial reconciliation records.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `period_start` | timestamp NOT NULL | |
| `period_end` | timestamp NOT NULL | |
| `total_revenue_cents` | integer | |
| `total_refunds_cents` | integer | |
| `net_revenue_cents` | integer | |
| `status` | varchar | draft/finalized |
| `created_at` | timestamp | |

### `closeout_audit_events`
Audit trail for closeout changes.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `closeout_id` | varchar NOT NULL | |
| `action` | varchar NOT NULL | |
| `performed_by` | varchar | |
| `notes` | text | |
| `created_at` | timestamp | |

### `wallet_transactions`
In-platform wallet transactions (balance changes on `users.balance_cents`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `user_id` | varchar NOT NULL | |
| `org_id` | varchar | |
| `type` | varchar NOT NULL | credit/debit/cashout/refund |
| `amount_cents` | integer NOT NULL | |
| `livemode` | boolean | NOT NULL |
| `idempotency_key` | varchar | UNIQUE (prevents duplicate credits) |
| `booking_id` | varchar | |
| `description` | text | |
| `created_at` | timestamp | |

> **Idempotency:** `wallet_transactions` has a DB-level UNIQUE index on `idempotency_key`; the credit function uses `onConflictDoNothing`.

### `cashouts`
Org payout requests and Stripe transfer records.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `amount_cents` | integer NOT NULL | |
| `stripe_transfer_id` | varchar | |
| `status` | varchar | pending/processing/completed/failed |
| `requested_by` | varchar | |
| `created_at` | timestamp | |

### `team_quotes`
Quoted pricing for team/group training packages.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `prospect_id` | varchar | |
| `contact_name` | varchar | |
| `contact_email` | varchar | |
| `program_type` | varchar | |
| `session_count` | integer | |
| `price_cents` | integer | |
| `status` | varchar | draft/sent/accepted/rejected |
| `notes` | text | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `stripe_webhook_events`
Idempotent Stripe webhook audit log.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | varchar | PK | |
| `stripe_event_id` | varchar | NOT NULL, UNIQUE | Idempotency key |
| `event_type` | varchar | NOT NULL | |
| `livemode` | boolean | NOT NULL, default false | |
| `processed_status` | varchar | NOT NULL, default pending | pending/success/failed/skipped |
| `processing_error` | text | | |
| `customer_id` | varchar | | |
| `payment_intent_id` | varchar | | |
| `subscription_id` | varchar | | |
| `org_id` | varchar | | |
| `user_id` | varchar | | |
| `amount_cents` | integer | | |
| `metadata` | jsonb | | |
| `received_at` | timestamp | NOT NULL, default now | |
| `processed_at` | timestamp | | |

---

## 5. Athletic Programs (Group/Team Sessions)

### `athletic_programs`
Group/team training program definitions (differs from individual `workout_programs`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `name` | varchar NOT NULL | |
| `description` | text | |
| `program_type` | varchar | team_training/group_class/camp/etc. |
| `price_cents` | integer | |
| `max_athletes` | integer | |
| `coach_id` | varchar | |
| `is_active` | boolean | default true |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `athletic_hour_schedules`
Recurring time slots for athletic programs.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `program_id` | varchar NOT NULL | |
| `org_id` | varchar NOT NULL | |
| `day_of_week` | integer | |
| `start_time` | varchar | HH:MM |
| `end_time` | varchar | HH:MM |
| `location_id` | varchar | |
| `created_at` | timestamp | |

### `athletic_bookings`
Client enrollment in athletic program sessions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `program_id` | varchar NOT NULL | |
| `user_id` | varchar NOT NULL | |
| `session_date` | timestamp | |
| `booking_status` | varchar | PENDING/CONFIRMED/CANCELLED |
| `price_cents` | integer | |
| `created_at` | timestamp | |

---

## 6. Personal Records (PR Tracking)

### `pr_teams`
Team groupings for PR tracking.

### `pr_team_members`
Athletes assigned to PR teams.

### `pr_lift_types`
Lift/exercise definitions for PR tracking (squat, bench, deadlift, etc.).

### `pr_lift_entries`
Individual PR records per athlete per lift.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `lift_type_id` | varchar NOT NULL | |
| `weight` | numeric | |
| `reps` | integer | |
| `date` | timestamp | |
| `notes` | text | |
| `created_at` | timestamp | |

### `pr_import_jobs`
Bulk PR data import job tracking.

### `pr_agent_research_jobs`
AI research jobs for discovering athlete PR data.

---

## 7. Athlete Intelligence & Profiles

### `athlete_public_profiles`
Public-facing athlete profile data for college recruiting / showcase pages.

### `athlete_ai_summaries`
AI-generated athlete performance summaries.

### `athlete_watchlists`
Coach watchlists tracking high-priority athletes.

### `athlete_intelligence_snapshots`
Point-in-time intelligence captures for trend analysis.

### `athlete_intelligence_alerts`
Triggered alerts when athlete metrics cross thresholds.

### `athlete_external_assets`
External links (film, highlights, etc.) attached to athlete profiles.

### `athlete_status_snapshots`
Composite risk/readiness snapshot per athlete (generated periodically).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `status_score` | integer | NOT NULL, default 0 |
| `risk_level` | varchar | NOT NULL, default green (green/yellow/red) |
| `readiness_score` | integer | 0–100 |
| `adherence_score` | integer | 0–100 |
| `recovery_score` | integer | 0–100 |
| `education_score` | integer | 0–100 |
| `engagement_score` | integer | 0–100 |
| `generated_at` | timestamp | default now |
| `metadata` | jsonb | |
| `created_at` | timestamp | |

### `athlete_risk_flags`
Active risk flags per athlete (injury, compliance, dropout risk).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `flag_type` | varchar NOT NULL | |
| `severity` | varchar | info/warning/critical |
| `title` | varchar NOT NULL | |
| `summary` | text NOT NULL | |
| `recommendation` | text | |
| `source_data` | jsonb | |
| `status` | varchar | active/resolved |
| `created_at` | timestamp | |
| `resolved_at` | timestamp | |

### `athlete_intervention_recommendations`
Coach-reviewable intervention proposals (never auto-applied).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `recommendation_type` | varchar NOT NULL | |
| `generated_by` | varchar | rules/ai |
| `title` | varchar NOT NULL | |
| `summary` | text NOT NULL | |
| `suggested_action` | text | |
| `related_pathway_id` | varchar | |
| `related_workout_id` | varchar | |
| `severity` | varchar | info/warning/critical |
| `status` | varchar | pending/approved/rejected/completed |
| `coach_notes` | text | |
| `created_at` | timestamp | |

### `athlete_context_objects`
Living intelligence summary per athlete — refreshed on session completion, readiness check-in, intervention, and daily cron.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `athlete_user_id` | varchar NOT NULL | |
| `org_id` | varchar NOT NULL | |
| `current_program_id` | varchar | |
| `current_program_week` | integer | |
| `current_program_phase` | varchar | |
| `compliance_rate` | integer | Indexed; queried frequently |
| `readiness_trend` | varchar | unknown/improving/declining/stable |
| `risk_level` | varchar | green/yellow/red |
| `last_30_day_readiness_trend` | jsonb | Array of readiness readings |
| `recent_session_feedback` | jsonb | |
| `recent_rpe_trend` | jsonb | |
| `recent_prs` | jsonb | |
| `missed_sessions` | jsonb | |
| `injury_notes` | jsonb | |
| `coach_notes` | jsonb | |
| `intervention_history` | jsonb | |
| `education_history` | jsonb | |
| `risk_flags` | jsonb | |
| `ai_summary` | text | AI-generated state summary |
| `last_refresh_trigger` | varchar | manual/cron/session_completed/etc. |
| `updated_at` | timestamp | |
| `created_at` | timestamp | |

---

## 8. Persistent Athlete Intelligence Layer (PAIL)

Three tables form the PAIL system (Phase 15). They store long-term learning that survives across programs, seasons, and coaches.

### `athlete_memory_profiles`
Long-term athlete memory store.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `primary_sport` | varchar | |
| `secondary_sport` | varchar | |
| `position` | varchar | |
| `competition_level` | varchar | |
| `training_age_years` | integer | |
| `preferred_exercises` | jsonb | string[] |
| `disliked_exercises` | jsonb | string[] |
| `preferred_session_length_min` | integer | |
| `preferred_training_days` | jsonb | string[] |
| `movement_restrictions` | jsonb | string[] |
| `recurring_compensations` | jsonb | string[] |
| `technical_focus_areas` | jsonb | string[] |
| `coaching_cues_that_work` | jsonb | string[] |
| `normal_readiness_range` | jsonb | { min, max, avg } |
| `fatigue_patterns` | text | |
| `recovery_patterns` | text | |
| `stress_patterns` | text | |
| `exercises_that_progress_well` | jsonb | string[] |
| `exercises_that_stall` | jsonb | string[] |
| `high_response_stimuli` | jsonb | string[] |
| `low_response_stimuli` | jsonb | string[] |
| `historical_injuries` | jsonb | Array<{area, date?, severity?}> |
| `recurring_pain_areas` | jsonb | string[] |
| `movement_red_flags` | jsonb | string[] |
| `coach_notes_summary` | text | |
| `coaching_history_summary` | text | |
| `last_coach_note_analyzed_at` | timestamp | |
| `trust_level` | integer | 0–3 autonomy trust |
| `trust_level_reason` | text | |
| `memory_confidence` | integer | 0–100 |
| `sessions_analyzed` | integer | |
| `last_synthesized_at` | timestamp | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `athlete_session_outcomes`
One row per completed/attempted session; links athlete → session → program for PAIL learning.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `session_id` | varchar NOT NULL | |
| `program_id` | varchar | |
| `session_completed` | boolean | |
| `session_modified` | boolean | Was the session changed during execution? |
| `pr_achieved` | boolean | |
| `exercises_with_pr` | jsonb | string[] |
| `readiness_change` | integer | Delta from previous check-in |
| `soreness_change` | integer | |
| `pain_change` | integer | |
| `compliance_score` | integer | 0–100 for this session |
| `rpe_avg` | integer | |
| `exercises_completed` | integer | default 0 |
| `exercises_total` | integer | default 0 |
| `notes` | text | |
| `created_at` | timestamp | |

### `exercise_effectiveness_scores`
Per-athlete per-exercise intelligence driving future programming.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `exercise_name` | varchar NOT NULL | |
| `exercise_id` | varchar | |
| `times_used` | integer | |
| `times_completed` | integer | |
| `completion_rate` | integer | 0–100 |
| `progression_rate` | integer | % sessions w/ load increase |
| `pr_rate` | integer | % sessions w/ PR |
| `soreness_rate` | integer | |
| `pain_rate` | integer | |
| `effectiveness_score` | integer | 0–100 |
| `last_calculated_at` | timestamp | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

---

## 9. Workout Builder & Programs

### `workout_programs`
Individual athlete training programs.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `created_by_user_id` | varchar | Coach |
| `athlete_user_id` | varchar | Target athlete |
| `title` | varchar NOT NULL | |
| `description` | text | |
| `duration_weeks` | integer | |
| `sessions_per_week` | integer | |
| `sport` | varchar | |
| `goal` | varchar | |
| `status` | varchar | draft/active/completed/archived |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `workout_program_assignments`
Tracks which athletes are assigned to which programs.

### `workout_sessions`
Individual session definitions within a program (week/day structure).

### `workout_completion_logs`
Records when a session is completed.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `workout_session_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `completed_at` | timestamp | default now |
| `notes` | text | |
| `rating` | integer | |
| `created_at` | timestamp | |

### `workout_readiness_checkins`
Pre-session readiness assessments (sleep, soreness, fatigue, stress, motivation).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `workout_session_id` | varchar | |
| `readiness_score` | integer | NOT NULL |
| `sleep_quality` | integer | |
| `soreness_level` | integer | |
| `fatigue_level` | integer | |
| `stress_level` | integer | |
| `motivation_level` | integer | |
| `pain_areas` | jsonb | |
| `notes` | text | |
| `created_at` | timestamp | |

### `workout_session_exercise_logs`
Exercise-level logs during a session execution.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `workout_session_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `exercise_name` | varchar NOT NULL | |
| `prescribed_data` | jsonb | |
| `completed_data` | jsonb | |
| `rpe` | integer | |
| `notes` | text | |
| `created_at` | timestamp | |

### `workout_adaptation_recommendations`
AI-generated program adjustment proposals (require coach approval).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `workout_program_id` | varchar NOT NULL | |
| `workout_session_id` | varchar | |
| `recommendation_type` | varchar NOT NULL | |
| `severity` | varchar | info/warning/critical, default info |
| `reason` | text NOT NULL | |
| `suggested_change` | jsonb | |
| `source` | varchar | rules/ai, default rules |
| `status` | varchar | pending/approved/rejected |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `workout_set_logs`
Set-level detail logs (weight, reps, RPE per set).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `workout_session_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `exercise_index` | integer | default 0 |
| `exercise_name` | varchar(200) NOT NULL | |
| `set_number` | integer | default 1 |
| `prescribed_reps` | varchar(50) | |
| `prescribed_load` | varchar(50) | |
| `actual_reps` | varchar(50) | |
| `actual_load` | varchar(50) | |
| `rpe` | integer | |
| `completed` | boolean | NOT NULL, default false |
| `duration_seconds` | integer | |
| `notes` | text | |
| `logged_at` | timestamp | default now |

### `athlete_streaks`
Workout streak tracking per athlete.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `current_streak` | integer | NOT NULL, default 0 |
| `longest_streak` | integer | NOT NULL, default 0 |
| `last_completed_date` | timestamp | |
| `total_sessions_completed` | integer | NOT NULL, default 0 |
| `updated_at` | timestamp | |

### `exercise_library`
Org-scoped and global exercise definitions with coaching cues.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar | Null = global |
| `name` | varchar(200) NOT NULL | |
| `slug` | varchar(200) NOT NULL | |
| `category` | varchar(100) | default strength |
| `movement_pattern` | varchar(100) | |
| `primary_muscles` | jsonb | |
| `secondary_muscles` | jsonb | |
| `equipment` | jsonb | |
| `difficulty` | varchar(50) | default intermediate |
| `description` | text | |
| `coaching_cues` | jsonb | |
| `common_mistakes` | jsonb | |
| `progressions` | jsonb | |
| `regressions` | jsonb | |
| `youtube_url` | varchar(500) | |
| `embedded_video_url` | varchar(500) | |
| `video_url` | varchar(500) | |
| `gif_url` | varchar(500) | |
| `thumbnail_url` | varchar(500) | |
| `coach_voiceover_url` | varchar(500) | |
| `demo_type` | varchar(30) | youtube/gif/video |
| `tags` | jsonb | |
| `is_global` | boolean | NOT NULL, default false |
| `created_by_user_id` | varchar | |
| `created_at` | timestamp | |

### `program_templates`
Saved program templates for reuse.

### `program_blocks`
Week-level training blocks within a program.

### `program_session_groups`
Exercise groupings (supersets, circuits) within a session.

### `workout_generation_metadata`
Intelligence metadata for each TrainChat AI generation call.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `workout_program_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar | |
| `context_object_id` | varchar | → `athlete_context_objects` |
| `readiness_adjustment_applied` | boolean | |
| `compliance_adjustment_applied` | boolean | |
| `rpe_adjustment_applied` | boolean | |
| `readiness_trend_at_generation` | varchar | |
| `compliance_rate_at_generation` | integer | |
| `ai_rationale` | text | |
| `modifiers_applied` | jsonb | |
| `generated_at` | timestamp | |

### `program_adaptation_drafts`
Coach-reviewable program adjustment proposals generated when context signals cross risk thresholds. Never auto-applied.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `workout_program_id` | varchar | |
| `trigger_reason` | text | |
| `proposed_changes` | jsonb | |
| `status` | varchar | pending/approved/rejected |
| `reviewed_by` | varchar | |
| `reviewed_at` | timestamp | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `intervention_outcomes`
Before/after impact tracking for approved interventions. Feeds learning engine.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `adaptation_draft_id` | varchar | Source: draft |
| `intervention_recommendation_id` | varchar | Source: recommendation |
| `intervention_type` | varchar NOT NULL | |
| `approved_at` | timestamp | |
| `evaluation_date` | timestamp | |
| `evaluated_at` | timestamp | |
| `readiness_before` | integer | |
| `readiness_after` | integer | |
| `readiness_delta` | integer | |
| `compliance_before` | integer | |
| `compliance_after` | integer | |
| `compliance_delta` | integer | |
| `rpe_before` | integer | |
| `rpe_after` | integer | |
| `rpe_delta` | integer | |
| `missed_sessions_before` | integer | |
| `missed_sessions_after` | integer | |
| `risk_level_before` | varchar | |
| `risk_level_after` | varchar | |
| `before_snapshot` | jsonb | Full metric snapshot |
| `after_snapshot` | jsonb | |
| `coach_feedback` | text | |
| `ai_effectiveness_rating` | integer | |
| `outcome_status` | varchar | default pending_evaluation |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `coach_daily_briefings`
AI-generated daily briefings for coaches.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `generated_at` | timestamp | default now |
| `briefing` | jsonb NOT NULL | Structured briefing data |
| `generated_by` | varchar | default gpt-4o |
| `summary` | text | |
| `created_at` | timestamp | |

---

## 10. Nutrition Education

### `nutrition_modules`
Nutrition curriculum modules (default or org-custom).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar | Null = default |
| `module_number` | integer NOT NULL | |
| `title` | varchar NOT NULL | |
| `description` | text | |
| `content` | jsonb | default {} |
| `is_default` | boolean | NOT NULL, default true |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `nutrition_quiz_questions`
Quiz questions tied to nutrition modules.

### `nutrition_progress`
Per-athlete nutrition module progress tracking.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `module_id` | varchar NOT NULL | |
| `status` | varchar | not_started/in_progress/completed |
| `quiz_score` | integer | |
| `completed_at` | timestamp | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `nutrition_quiz_attempts`
Per-attempt quiz records.

---

## 11. Education Builder & Adaptive Learning

### Core Education Tables

#### `education_pathways`
Top-level curriculum containers (e.g., "Nutrition Foundations", "Recovery Protocols").

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar | Null = system |
| `created_by_user_id` | varchar | |
| `title` | varchar NOT NULL | |
| `slug` | varchar NOT NULL | |
| `category` | varchar | default custom |
| `description` | text | |
| `status` | varchar | draft/active/archived |
| `is_default` | boolean | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `education_modules`
Individual modules within a pathway (lessons, videos, coaching notes).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar | |
| `pathway_id` | varchar NOT NULL | |
| `module_number` | integer NOT NULL | |
| `title` | varchar NOT NULL | |
| `description` | text | |
| `content` | jsonb | default {} |
| `key_takeaways` | jsonb | default [] |
| `estimated_minutes` | integer | default 10 |
| `video_url` | varchar | |
| `video_search_query` | varchar | |
| `performance_connection` | text | |
| `coach_reinforcement_notes` | jsonb | |
| `status` | varchar | draft/active |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `education_quiz_questions`
Quiz questions per module.

#### `education_progress`
Per-athlete, per-module progress tracking.

#### `education_assignments`
Coach assignments of pathways to athletes or teams.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `pathway_id` | varchar NOT NULL | |
| `assigned_to_type` | varchar NOT NULL | individual/team |
| `athlete_user_id` | varchar | If individual |
| `team_id` | varchar | If team |
| `assigned_by_user_id` | varchar NOT NULL | |
| `due_date` | timestamp | |
| `created_at` | timestamp | |

#### `education_ai_generations`
AI generation records for pathway/module content.

### Adaptive Learning System (Phase 2)

#### `education_rules`
IF/THEN automation rules (e.g., if readiness < 3 for 7 days → assign Recovery pathway).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `created_by_user_id` | varchar NOT NULL | |
| `name` | varchar NOT NULL | |
| `trigger_type` | varchar NOT NULL | athlete_joined/readiness_low/quiz_failed/pathway_completed/module_overdue |
| `trigger_config` | jsonb | { threshold, days, pathwayId, score } |
| `action_type` | varchar NOT NULL | assign_pathway/notify_coach/award_badge/send_reminder |
| `action_config` | jsonb | { pathwayId, badgeId, message } |
| `is_active` | boolean | NOT NULL, default true |
| `requires_approval` | boolean | NOT NULL, default true |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `education_assignment_plans`
Week-by-week curriculum plans for individuals or teams.

#### `education_badges`
Badge definitions (org-custom or system defaults).

#### `education_athlete_badges`
Earned badges per athlete.

#### `education_ai_recommendations`
AI-generated pathway recommendations — require coach approval before assignment.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `pathway_id` | varchar NOT NULL | |
| `reasoning` | text NOT NULL | |
| `trigger_context` | jsonb | { readinessScore, quizScore, missedSessions, triggerType } |
| `status` | varchar | pending/approved/rejected/expired |
| `reviewed_by_user_id` | varchar | |
| `reviewed_at` | timestamp | |
| `created_at` | timestamp | |

### Organization Event Log (Phase 4)

#### `organization_event_log`
Event-driven org intelligence — cross-system event bus.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | crypto.randomUUID() |
| `org_id` | text NOT NULL | |
| `event_id` | text | NOT NULL, UNIQUE |
| `event_type` | text NOT NULL | |
| `source_system` | text NOT NULL | |
| `athlete_user_id` | text | |
| `coach_user_id` | text | |
| `payload` | jsonb | |
| `triggered_workflows` | jsonb | |
| `resulting_actions` | jsonb | |
| `resolution_state` | text | default open |
| `resolved_at` | timestamp | |
| `escalation_level` | integer | default 0 |
| `correlation_id` | text | |
| `created_at` | timestamp | |

#### `organization_intelligence_state`
One row per org — aggregated health metrics updated by daily ops.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text | NOT NULL, UNIQUE |
| `overall_health_score` | integer | default 100 |
| `intervention_load` | integer | |
| `critical_athlete_count` | integer | |
| `unresolved_critical_athletes` | jsonb | |
| `coach_workload_score` | integer | |
| `compliance_health_score` | integer | |
| `engagement_trend_direction` | text | stable/improving/declining |
| `fatigue_risk_level` | text | low/medium/high |
| `recovery_trend_direction` | text | |
| `readiness_distribution` | jsonb | |
| `predicted_churn_risks` | integer | |
| `unresolved_interventions` | integer | |
| `last_daily_ops_at` | timestamp | |
| `last_updated_at` | timestamp | |
| `updated_at` | timestamp | |

---

## 12. Parent / Guardian Portal

### `parent_guardians`
Guardian profile records (one per org-user who is a guardian).

### `athlete_guardian_links`
Links between athletes and their guardians, with permission controls.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `athlete_user_id` | varchar NOT NULL | |
| `guardian_user_id` | varchar NOT NULL | |
| `status` | varchar | pending/active/revoked |
| `invited_by_user_id` | varchar | |
| `invite_email` | varchar | |
| `invite_token` | varchar | |
| `permissions` | jsonb | Granular permission set |
| `created_at` | timestamp | |
| `activated_at` | timestamp | |

### `guardian_notifications`
Guardian-targeted notifications (session reminders, progress updates).

---

## 13. Communications & Notifications

### `org_messages`
Internal direct messages between org members.

### `org_message_reads`
Read receipts for org messages.

### `org_notifications`
In-app notification feed per user.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `user_id` | varchar NOT NULL | |
| `type` | varchar NOT NULL | |
| `title` | varchar NOT NULL | |
| `message` | text NOT NULL | |
| `action_url` | varchar | |
| `metadata` | jsonb | |
| `is_read` | boolean | NOT NULL, default false |
| `created_at` | timestamp | |

### `notification_automation_logs`
Audit trail for automated notification delivery.

### `org_activity_events`
Organization-wide activity feed (athlete achievements, session milestones, etc.).

### `org_notification_preferences`
Per-user, per-org notification channel preferences.

### `org_email_notification_settings`
Per-org booking email toggles (athlete confirmations, admin alerts, dedup window).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar | NOT NULL, UNIQUE |
| `athlete_booking_confirmation` | boolean | NOT NULL, default true |
| `athlete_recurring_confirmation` | boolean | NOT NULL, default true |
| `athlete_reschedule` | boolean | NOT NULL, default true |
| `athlete_cancellation` | boolean | NOT NULL, default true |
| `athlete_reminder` | boolean | NOT NULL, default true |
| `admin_new_booking` | boolean | NOT NULL, default true |
| `admin_recurring_booking` | boolean | NOT NULL, default false |
| `admin_reschedule` | boolean | NOT NULL, default true |
| `admin_cancellation` | boolean | NOT NULL, default true |
| `dedup_window_minutes` | integer | NOT NULL, default 15 |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

---

## 14. Lead Capture & Intelligence

### `lead_capture_programs`
Landing page / application form configurations per org.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `organization_id` | varchar NOT NULL | |
| `program_id` | varchar | NOT NULL, UNIQUE |
| `headline` | text | |
| `subheadline` | text | |
| `cta_text` | varchar | |
| `hero_image_url` | text | |
| `benefits` | jsonb | |
| `social_proof` | jsonb | |
| `who_is_this_for` | text | |
| `meta_pixel_id` | varchar | |
| `google_ads_conversion_id` | varchar | |
| `google_ads_conversion_label` | varchar | |
| `booking_url` | text | |
| `booking_type` | varchar | none/external/internal |
| `estimated_athlete_value_cents` | integer | |
| `extended_config` | jsonb | Testimonials, form config, branding |
| `funnel_type` | varchar | default athlete_application |
| `show_in_org_menu` | boolean | NOT NULL, default true |
| `nav_label` | varchar(120) | |
| `nav_order` | integer | NOT NULL, default 0 |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `lead_capture_submissions`
Individual form submissions (athlete applications).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `program_id` | varchar NOT NULL | |
| `athlete_name` | varchar NOT NULL | |
| `parent_name` | varchar | |
| `email` | varchar NOT NULL | |
| `phone` | varchar | |
| `age` | varchar | |
| `grade` | varchar | |
| `sport` | varchar | |
| `position` | varchar | |
| `school` | varchar | |
| `goals` | text[] | |
| `experience_level` | varchar | |
| `current_training_status` | varchar | |
| `commitment_level` | varchar | |
| `notes` | text | |
| `ai_qualification_score` | integer | |
| `ai_qualification_reason` | text | |
| `utm_source` | varchar | |
| `utm_medium` | varchar | |
| `utm_campaign` | varchar | |
| `utm_content` | varchar | |
| `utm_term` | varchar | |
| `abandoned_id` | varchar | |
| `contacted_at` | timestamp | |
| `last_follow_up_at` | timestamp | |
| `follow_up_count` | integer | |
| `sequence_status` | varchar | |
| `ai_next_action` | text | |
| `booking_status` | varchar | not_booked/booked/etc. |
| `booked_at` | timestamp | |
| `evaluation_booked_at` | timestamp | |
| `attended_at` | timestamp | |
| `converted_at` | timestamp | |
| `lost_at` | timestamp | |
| `estimated_value_cents` | integer | |
| `ai_sales_analysis` | jsonb | |
| `admin_email_sent_at` | timestamp | |
| `admin_email_status` | varchar | |
| `admin_email_error` | text | |
| `applicant_email_sent_at` | timestamp | |
| `applicant_email_status` | varchar | |
| `applicant_email_error` | text | |
| `linked_user_id` | varchar | Post-submission user linkage |
| `signup_converted_at` | timestamp | |
| `booking_converted_at` | timestamp | |
| `created_at` | timestamp | |

### `lead_capture_abandoned`
Partial form submissions (started but not completed).

### `lead_capture_follow_ups`
Follow-up email/SMS records for submissions and abandoned leads.

### `lead_capture_funnel_events`
Page-view and funnel-step analytics events.

### `lead_intelligence_profiles`
AI-generated context, lead scoring, and pipeline state for every captured lead. One row per submission (1:1 with `lead_capture_submissions`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `submission_id` | varchar | NOT NULL, UNIQUE |
| `pipeline_stage` | varchar | new_lead/contacted/evaluation_booked/... |
| `ai_summary` | text | |
| `normalized_profile_json` | jsonb | Full intake profile |
| `lead_score` | integer | 0–100 |
| `temperature` | varchar | cold/warm/hot |
| `urgency` | varchar | low/medium/high |
| `suggested_next_action` | varchar | |
| `suggested_next_action_reason` | text | |
| `campaign_source` | varchar | |
| `campaign_medium` | varchar | |
| `campaign_name` | varchar | |
| `landing_page_id` | varchar | |
| `program_id` | varchar | |
| `tags` | text[] | |
| `gmail_draft_action_id` | varchar | |
| `initial_draft_subject` | text | |
| `initial_draft_body` | text | |
| `follow_up_stage` | varchar | none/sequence_1/sequence_2/... |
| `last_interaction_at` | timestamp | |
| `next_follow_up_at` | timestamp | |
| `unsubscribed` | boolean | NOT NULL, default false |
| `suppressed` | boolean | NOT NULL, default false |
| `suppression_reason` | text | |
| `suppressed_at` | timestamp | |
| `stage_transitions` | jsonb | [{fromStage, toStage, reason, source, confidence, timestamp}] |
| `intake_processed_at` | timestamp | |
| `scoring_processed_at` | timestamp | |
| `draft_generated_at` | timestamp | |
| `processing_log` | jsonb | |
| `processing_duration_ms` | integer | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `lead_scheduling_contexts`
Scheduling lifecycle for a lead: slot offer → confirmation → booking.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `lead_id` | varchar NOT NULL | |
| `submission_id` | varchar | NOT NULL, UNIQUE |
| `gmail_thread_id` | varchar | |
| `offered_slots` | jsonb NOT NULL | |
| `selected_slot` | jsonb | |
| `status` | varchar | none/slots_offered/awaiting_confirmation/booked/expired/cancelled |
| `expires_at` | timestamp | |
| `athletic_booking_id` | varchar | |
| `last_reply_message_id` | varchar | |
| `notes` | text | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

---

## 15. Team Training Prospecting & Deals

### `team_training_prospects`
B2B prospects (schools, gyms, facilities) for team training outreach.

Key columns include: `organization_type`, `contact_email`, `contact_name`, `contact_title`, `contact_quality` (decision_maker/role_based/general/missing), `contact_source_title`, `contact_source_snippet`, `contact_discovery_method`, `contact_confidence_score` (0.00–1.00), `contact_discovered_at`, `last_discovery_attempt_at`, `last_discovery_result`, `organization_id` (tenant), `status`, `notes`.

### `team_training_discovery_log`
Log of automated prospect discovery runs.

### `email_message_variants`
A/B test variants for outreach email messages.

### `team_training_outreach_drafts`
AI-generated outreach email drafts pending human approval.

### `email_follow_ups`
Follow-up email records for team training outreach sequences.

### `team_training_outreach_events`
Audit trail of all outreach events (sent, replied, bounced).

### `prospect_opt_outs`
Opt-out / suppression list for team training prospects.

### `team_training_lead_settings`
Per-org configuration for team training lead generation and outreach.

### `team_training_deals`
Deal pipeline records for team training prospects.

> **Note:** Uses `organization_id` (not `org_id`) and `status` (not `stage`) columns. See CEO Heartbeat topic file.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `organization_id` | varchar NOT NULL | Tenant scope |
| `prospect_id` | varchar | |
| `contact_name` | varchar | |
| `contact_email` | varchar | |
| `organization_name` | varchar | |
| `status` | varchar | prospecting/outreach/proposal/negotiation/won/lost |
| `deal_value_cents` | integer | |
| `probability` | integer | 0–100 |
| `expected_close_date` | timestamp | |
| `notes` | text | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `deal_activities`
Activity timeline for deal records (calls, emails, meetings).

### `campaigns`
Email campaign definitions for team training outreach.

### `organization_media`
Media assets (logos, photos) for organizations.

### `deal_revenue_attributions`
Multi-touch revenue attribution linking deals to revenue events.

---

## 16. Email / Gmail Agent Layer

### `gmail_conversations`
Linked Gmail threads to leads, deals, or clients.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `lead_id` | text | |
| `deal_id` | text | |
| `client_id` | text | |
| `gmail_thread_id` | text NOT NULL | |
| `last_message_id` | text | |
| `subject` | text | |
| `participant_email` | text | |
| `participant_name` | text | |
| `status` | text | open/closed/archived |
| `intent` | text | AI-classified intent |
| `last_inbound_at` | timestamp | |
| `last_outbound_at` | timestamp | |
| `last_snippet` | text | |
| `processed_at` | timestamp | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `gmail_agent_actions`
Audit log for every Gmail agent action (send, draft, classify, read).

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `action_type` | text NOT NULL | send/draft/classify/read/reply |
| `gmail_thread_id` | text | |
| `gmail_message_id` | text | |
| `lead_id` | text | |
| `deal_id` | text | |
| `recipient_email` | text | |
| `subject` | text | |
| `body_preview` | text | |
| `risk_level` | text | low/medium/high (NOT NULL, default medium) |
| `approval_required` | boolean | NOT NULL, default true |
| `status` | text | proposed/approved/sent/rejected/failed |
| `result` | jsonb | |
| `error_message` | text | |
| `created_by_agent` | text | |
| `approved_by` | text | |
| `created_at` | timestamp | |
| `executed_at` | timestamp | |
| `communication_domain` | text | default athlete_lead |

### `agent_message_feedback`
Human review decisions → training data for agent improvement.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `proposal_id` | text NOT NULL | → `gmail_agent_actions.id` |
| `lead_id` | text | |
| `agent_name` | text | |
| `message_type` | text | |
| `original_subject` | text | |
| `original_body` | text | |
| `edited_subject` | text | |
| `edited_body` | text | |
| `decision` | text NOT NULL | approved/edited_and_approved/rejected |
| `rejection_reason` | text | |
| `quality_rating` | integer | |
| `reviewer_notes` | text | |
| `reviewed_by` | text | |
| `reviewed_at` | timestamp | default now |
| `lead_context_json` | jsonb | |
| `outcome` | text | sent/replied/booked/ignored/bounced |
| `coaching_feedback_text` | text | |
| `feedback_tags` | jsonb | string[] |
| `extracted_preferences` | jsonb | |
| `extracted_avoid_rules` | jsonb | |
| `extracted_do_rules` | jsonb | |
| `applies_to_lead_type` | text | |
| `applies_to_program` | text | |
| `preference_strength` | text | weak/medium/strong |
| `should_apply_globally` | boolean | default false |
| `communication_domain` | text | default athlete_lead |
| `outcome_data` | jsonb | |
| `applied_to_future_runs` | boolean | default false |
| `created_at` | timestamp | |

### `agent_message_learning_rules`
Durable rules extracted from feedback; injected into future AI generation.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `source_feedback_id` | text | |
| `rule_type` | text NOT NULL | do/avoid/tone/cta/length/personalization/lead_stage |
| `rule_text` | text NOT NULL | |
| `message_type` | text | |
| `lead_type` | text | |
| `program` | text | |
| `applies_globally` | boolean | default false |
| `confidence` | text | default "0.80" |
| `weight` | integer | default 1 |
| `status` | text | active/superseded/archived |
| `created_by` | text | |
| `created_at` | timestamp | |
| `last_applied_at` | timestamp | |
| `times_applied` | integer | default 0 |
| `success_count` | integer | default 0 |
| `rejection_count` | integer | default 0 |
| `communication_domain` | text | default athlete_lead |

### `agent_message_revisions`
Revision history when admin uses "Regenerate with feedback".

### `agent_autonomy_settings`
Per-org, per-message-type autonomy level controls.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `message_type` | text NOT NULL | |
| `autonomy_level` | integer | NOT NULL, default 0 (0=human only, 1=suggest, 2=auto low-risk, 3=autonomous) |
| `enabled` | boolean | NOT NULL, default false |
| `updated_by` | text | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |
| `communication_domain` | text | default athlete_lead |

### `agent_autonomy_decisions`
Full audit log of every policy evaluation.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `action_id` | text | |
| `lead_id` | text | |
| `deal_id` | text | |
| `action_type` | text NOT NULL | |
| `decision` | text NOT NULL | auto_execute/approval_required/blocked |
| `reasons` | jsonb NOT NULL | |
| `confidence` | doublePrecision NOT NULL | |
| `risk_level` | text NOT NULL | |
| `policy_version` | text | |
| `settings_snapshot` | jsonb | |
| `created_at` | timestamp | |
| `executed_at` | timestamp | |
| `result` | text | |
| `error_message` | text | |

### `org_automation_settings`
Granular per-org settings for the Autonomy Policy Engine. All dangerous flags default `false`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text | NOT NULL, UNIQUE |
| `auto_send_first_response` | boolean | NOT NULL, default false |
| `auto_send_low_risk_follow_ups` | boolean | NOT NULL, default false |
| `auto_send_booking_confirmation` | boolean | NOT NULL, default false |
| `auto_offer_scheduling_slots` | boolean | NOT NULL, default false |
| `auto_book_confirmed_slots` | boolean | NOT NULL, default false |
| `min_auto_send_confidence` | doublePrecision | NOT NULL, default 0.85 |
| `min_auto_booking_confidence` | doublePrecision | NOT NULL, default 0.90 |
| `daily_email_cap` | integer | NOT NULL, default 20 |
| `daily_booking_cap` | integer | NOT NULL, default 10 |
| `allowed_send_window_start` | text | NOT NULL, default "08:00" |
| `allowed_send_window_end` | text | NOT NULL, default "20:00" |
| `require_approval_for_first_contact` | boolean | NOT NULL, default true |
| `require_approval_for_new_recipients` | boolean | NOT NULL, default true |
| `notify_coach_on_auto_action` | boolean | NOT NULL, default true |
| `policy_version` | text | NOT NULL, default "1.0.0" |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `email_trigger_events`
Audit log for every email trigger decision (the "why did the email send?" log).

### `agent_action_log`
General agent action log (older, pre-unified-log table).

### `agent_actions`
Pending/queued agent actions awaiting execution.

---

## 17. Revenue Intelligence

### `ai_revenue_events`
All AI-attributed revenue events. Column is `outcome_value` (integer), not `amount`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `action_type` | varchar NOT NULL | |
| `entity_type` | varchar | |
| `entity_id` | varchar | |
| `outcome_value` | integer | Revenue in cents |
| `credited_value` | integer | Equal-split attribution value |
| `attributed_at` | timestamp | |
| `credited_to_agent` | varchar | |
| `execution_log_id` | varchar | → gmail_agent_actions for attribution |
| `created_at` | timestamp | |

### `revenue_agent_actions`
Revenue agent specific action records.

### `revenue_agent_settings`
Per-org revenue agent configuration.

### `revenue_agent_runs`
Revenue agent execution runs audit trail.

### `agent_communication_outcomes`
Tracks real-world outcomes for every sent AI communication (opened, replied, booked, converted).

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `gmail_action_id` | text | → `gmail_agent_actions` |
| `feedback_id` | text | → `agent_message_feedback` |
| `communication_domain` | text | NOT NULL, default athlete_lead |
| `message_type` | text | |
| `recipient_email` | text | |
| `recipient_name` | text | |
| `lead_id` | text | |
| `prospect_id` | text | |
| `deal_id` | text | |
| `applicant_id` | text | |
| `sent_at` | timestamp | |
| `opened_at` | timestamp | |
| `replied_at` | timestamp | |
| `meeting_booked_at` | timestamp | |
| `proposal_requested_at` | timestamp | |
| `proposal_sent_at` | timestamp | |
| `proposal_accepted_at` | timestamp | |
| `contract_signed_at` | timestamp | |
| `hired_at` | timestamp | |
| `booked_session_at` | timestamp | |
| `converted_at` | timestamp | |
| `lost_at` | timestamp | |
| `outcome_status` | text | NOT NULL, default sent |
| `revenue_cents` | integer | default 0 |
| `outcome_source` | text | default manual_update |
| `metadata` | jsonb | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `agent_rule_effectiveness`
Outcome-weighted performance of each learning rule.

### `employment_applicants`
Applicant records for Employment communication domain.

---

## 18. AI Governance & Infrastructure

### `org_ai_governance_settings`
Central organizational AI governance profile. One row per org.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text | NOT NULL, UNIQUE |
| `default_autonomy_mode` | text | supervised/collaborative/autonomous |
| `maximum_allowed_risk_level` | text | low/medium/high/critical |
| `default_confidence_threshold` | doublePrecision | default 0.75 |
| `operator_review_required` | boolean | default true |
| `allow_autonomous_communication` | boolean | default false |
| `allow_autonomous_scheduling` | boolean | default false |
| `allow_autonomous_financial_actions` | boolean | default false |
| `allow_research_agents` | boolean | default true |
| `allow_external_web_access` | boolean | default false |
| `allow_cross_workflow_memory` | boolean | default true |
| `ai_activity_visibility_mode` | text | full/summarized/minimal |
| `strict_mode_enabled` | boolean | default false |
| `emergency_pause_enabled` | boolean | default false |
| `emergency_pause_reason` | text | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `agent_capability_policies`
Per-org, per-agent capability configuration.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `agent_type` | text NOT NULL | executive_agent/growth_agent/retention_agent/etc. |
| `capability_name` | text NOT NULL | |
| `capability_category` | text NOT NULL | |
| `enabled` | boolean | default true |
| `requires_approval` | boolean | default true |
| `max_autonomy_level` | text | supervised/collaborative/autonomous |
| `minimum_confidence_score` | doublePrecision | default 0.75 |
| `allowed_risk_levels` | text[] | default ["low"] |
| `requires_human_review` | boolean | default true |
| `escalation_required` | boolean | default false |
| `execution_limits` | jsonb | { maxEmailsPerHour, maxWorkflowExecutionsPerDay, ... } |
| `allowed_tools` | jsonb | string[] or null (null = all allowed) |
| `restricted_tools` | jsonb | string[] or null |
| `notes` | text | |
| `created_by` | text | default system |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `external_integrations`
Central registry of all external system connections per org.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `integration_type` | text NOT NULL | gmail/google_calendar/slack/openrouter/claude/meta_ads/hubspot/twilio/discord/custom_webhook |
| `status` | text | connected/disconnected/degraded/paused/error |
| `display_name` | text | |
| `auth_type` | text | oauth/api_key/webhook |
| `encrypted_credentials` | jsonb | default {} |
| `scopes` | jsonb | default [] |
| `last_health_check_at` | timestamp | |
| `last_successful_action_at` | timestamp | |
| `last_failure_at` | timestamp | |
| `last_failure_reason` | text | |
| `rate_limit_state` | jsonb | |
| `usage_stats` | jsonb | |
| `governance_restrictions` | jsonb | |
| `enabled_agents` | jsonb | |
| `enabled_tools` | jsonb | |
| `created_by` | text | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `integration_execution_log`
Immutable audit trail for every action executed through the integration runtime.

### `org_execution_rate_limits`
Per-org, per-category execution rate limit tracking.

### `agent_execution_locks`
Distributed locks preventing race conditions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `lock_key` | text | NOT NULL, UNIQUE |
| `entity_type` | text | |
| `entity_id` | text | |
| `workflow_run_id` | text | |
| `locked_by` | text NOT NULL | |
| `expires_at` | timestamp NOT NULL | Auto-expire prevents deadlocks |
| `created_at` | timestamp | |

---

## 19. Workflow Orchestration

### `workflow_jobs`
Durable job queue for all agent actions, workflow steps, tool calls, and scheduled triggers.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `workflow_run_id` | text | |
| `workflow_step_id` | text | |
| `job_type` | text | workflow_step/tool_execution/scheduled_trigger/retry/approval_timeout/memory_lifecycle/business_brain_run/notification |
| `status` | text | queued/running/completed/failed/retrying/cancelled/dead_letter/paused |
| `priority` | text | low/normal/high/critical |
| `scheduled_for` | timestamp | |
| `started_at` | timestamp | |
| `completed_at` | timestamp | |
| `failed_at` | timestamp | |
| `attempts` | integer | default 0 |
| `max_attempts` | integer | default 3 |
| `next_retry_at` | timestamp | |
| `retry_backoff_ms` | integer | default 5000 |
| `last_error` | text | |
| `error_type` | text | transient/blocked/fatal/governance/timeout/rate_limited |
| `payload` | jsonb | |
| `result` | jsonb | |
| `idempotency_key` | text | UNIQUE |
| `locked_by` | text | |
| `locked_at` | timestamp | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `workflow_context`
Persistent memory for workflows, entities, and organizational patterns.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `entity_type` | text NOT NULL | athlete/lead/coach/workflow/campaign/client |
| `entity_id` | text NOT NULL | |
| `context_type` | text NOT NULL | interaction_history/workflow_memory/business_memory/communication_memory/operator_override/ai_reasoning_memory |
| `summary` | text NOT NULL | |
| `structured_context` | jsonb | |
| `last_outcome` | text | |
| `last_confidence_score` | doublePrecision | |
| `memory_importance_score` | doublePrecision | default 0.5 |
| `source_workflow_id` | text | |
| `source_action_log_id` | text | |
| `created_by` | text | system/agent/admin/coach |
| `archived` | boolean | default false |
| `compressed` | boolean | default false |
| `never_delete` | boolean | default false |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `workflow_outcomes`
Measurable business outcomes from autonomous/semi-autonomous workflows.

### `workflow_graphs`
Visual workflow definitions built in the Workflow Builder (nodes/edges/viewport).

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `name` | text NOT NULL | |
| `description` | text | |
| `category` | text | onboarding/retention/outreach/scheduling/research/executive/custom |
| `graph_version` | integer | NOT NULL, default 1 |
| `graph_definition` | jsonb NOT NULL | { nodes, edges, viewport } |
| `compiled_definition` | jsonb | Compiled execution plan |
| `risk_level` | text | low/medium/high/critical |
| `estimated_complexity` | integer | |
| `estimated_execution_cost_cents` | integer | |
| `requires_approval` | boolean | NOT NULL, default false |
| `governance_warnings` | jsonb | |
| `tags` | jsonb | |
| `published` | boolean | NOT NULL, default false |
| `active` | boolean | NOT NULL, default true |
| `is_template` | boolean | NOT NULL, default false |
| `template_rating` | integer | |
| `source_template_id` | text | |
| `created_by` | text | |
| `last_compiled_at` | timestamp | |
| `last_simulated_at` | timestamp | |
| `last_published_at` | timestamp | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `workflow_graph_versions`
Immutable snapshots of published workflow graphs; active runs pin to a version.

### `workflow_conflicts`
Detected conflicts between workflow definitions (trigger overlap, action overlap, etc.).

### `workflow_execution_logs`
Execution records for individual workflow runs.

### `workflow_registry`
Unified catalog of system, template, and org-custom workflows.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `workflow_key` | text NOT NULL | |
| `name` | text NOT NULL | |
| `description` | text | |
| `workflow_type` | text | lead_pipeline/outreach/scheduling/recovery/retention/automation/governance/custom |
| `source` | text | system/template/org_custom |
| `protected` | boolean | NOT NULL, default false |
| `editable` | boolean | NOT NULL, default true |
| `enabled` | boolean | NOT NULL, default true |
| `system_managed` | boolean | NOT NULL, default false |
| `version` | text | NOT NULL, default "1.0.0" |
| `cloned_from_workflow_id` | text | |
| `execution_count` | integer | |
| `success_count` | integer | |
| `failure_count` | integer | |
| `blocked_count` | integer | |
| `last_run_at` | timestamp | |
| `last_success_at` | timestamp | |
| `last_failure_at` | timestamp | |
| `estimated_revenue_influenced` | integer | |
| `estimated_bookings_created` | integer | |
| `estimated_leads_converted` | integer | |
| `workflow_definition` | jsonb | |
| `tags` | text[] | |
| `trigger_types` | text[] | |
| `action_types` | text[] | |
| `created_by` | text | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### Legacy Workflow Tables (pre-graph engine)

- `workflow_runs` — Execution runs of named workflows
- `workflow_steps` — Step definitions within a workflow
- `workflow_step_runs` — Per-step execution records
- `workflow_settings` — Per-workflow configuration
- `connector_tokens` — OAuth/API tokens for workflow connectors
- `agent_invoices` — Invoice records generated by agents
- `attention_items` — Items requiring human attention
- `agent_pending_actions` — Queued actions awaiting approval
- `operator_actions` — Human operator action records
- `operator_action_events` — Events on operator actions
- `retention_workflows` — Retention-specific workflow definitions
- `retention_workflow_events` — Events in retention workflows
- `outreach_drafts` — Outreach email draft records
- `outreach_events` — Outreach event audit trail

---

## 20. CEO Heartbeat & Agent Orchestration

### `unified_agent_action_log`
Central audit table for all AI/automation activity across the platform.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `actor_type` | text | agent/system/admin/coach |
| `actor_name` | text | |
| `action_type` | text NOT NULL | |
| `entity_type` | text | |
| `entity_id` | text | |
| `workflow_run_id` | text | |
| `tool_name` | text | |
| `status` | text | started/completed/failed/skipped/requires_approval |
| `confidence_score` | doublePrecision | |
| `risk_level` | text | low/medium/high/critical |
| `input_snapshot` | jsonb | |
| `output_snapshot` | jsonb | |
| `reasoning_summary` | text | |
| `error_message` | text | |
| `rollback_available` | boolean | default false |
| `created_at` | timestamp | |

### `apex_recommendations`
Apex growth agent recommendations with full lifecycle management.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `signal_type` | text NOT NULL | Dedup key component |
| `entity_type` | text NOT NULL | |
| `entity_id` | text NOT NULL | |
| `entity_name` | text | |
| `urgency` | text | low/medium/high/critical |
| `estimated_value_cents` | integer | |
| `reason_text` | text | |
| `recommended_action` | text | |
| `confidence_score` | doublePrecision | |
| `stale_days` | integer | |
| `source_url` | text | |
| `status` | text | pending_review/approved/dismissed/completed/expired |
| `status_updated_at` | timestamp | |
| `status_updated_by` | text | |
| `dismiss_reason` | text | |
| `run_id` | text | |
| `expires_at` | timestamp | Default 7 days from creation |
| `created_at` | timestamp | |

### `ceo_heartbeat_runs`
Tracks every CEO Heartbeat orchestration cycle.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `triggered_by` | text | cron/manual/api |
| `status` | text | running/completed/failed/paused |
| `agents_coordinated` | integer | |
| `actions_evaluated` | integer | |
| `actions_auto_executed` | integer | |
| `actions_pending_approval` | integer | |
| `priorities_generated` | integer | |
| `errors_encountered` | integer | |
| `duration_ms` | integer | |
| `summary_json` | jsonb | |
| `error_message` | text | |
| `started_at` | timestamp | default now |
| `completed_at` | timestamp | |

### `job_execution_locks`
Per-job distributed locks preventing duplicate cron execution.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `job_name` | text NOT NULL | |
| `lock_key` | text | NOT NULL, UNIQUE |
| `acquired_at` | timestamp | default now |
| `expires_at` | timestamp | NOT NULL |
| `released_at` | timestamp | |
| `status` | text | acquired/released/expired |

> **Critical:** `releaseJobLock()` must DELETE the row (not UPDATE to "released"), or the same lock key blocks future runs within the 28-min window. Startup cleanup deletes lingering rows.

### `agent_operating_timeline`
Unified single table for every agent action, recommendation, outcome, approval, send, skip, error, and learning event across the platform.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `heartbeat_id` | text | |
| `agent_name` | text NOT NULL | |
| `system_name` | text | |
| `action_type` | text NOT NULL | recommendation/draft_created/approval_required/email_sent/reply_detected/workflow_executed/booking_created/revenue_outcome/error/skipped_duplicate/auto_executed/learning_event/program_generated/heartbeat_cycle |
| `action_status` | text | pending/completed/failed/skipped/requires_approval/approved/rejected |
| `priority` | integer | default 50 |
| `communication_domain` | text | |
| `related_entity_type` | text | gmail_action/lead/prospect/booking/deal/applicant/workflow/program |
| `related_entity_id` | text | |
| `summary` | text | |
| `decision_reason` | text | |
| `requires_approval` | boolean | default false |
| `approval_status` | text | pending/approved/rejected/auto_approved |
| `executed_at` | timestamp | |
| `outcome_status` | text | |
| `error_message` | text | |
| `metadata` | jsonb | |
| `created_at` | timestamp | |

### `admin_action_audit_log`
Immutable record of every human admin action in the platform.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `admin_user_id` | text NOT NULL | |
| `admin_email` | text | |
| `action_type` | text NOT NULL | approval/rejection/edit/send/autonomy_change/emergency_pause/workflow_publish/outcome_update/bulk_approve/heartbeat_trigger/settings_change |
| `target_table` | text | |
| `target_id` | text | |
| `before_state` | jsonb | |
| `after_state` | jsonb | |
| `ip_address` | text | |
| `user_agent` | text | |
| `notes` | text | |
| `created_at` | timestamp | |

---

## 21. AI Workforce Operations

### `org_ai_workforce_settings`
Persists every wizard selection from the AI Workforce Setup Wizard. One row per org.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `goals` | jsonb | Operator-selected goals |
| `org_preset` | text | private_trainer/performance_facility/etc. |
| `enabled_departments` | jsonb | Drives isAgentEnabledForOrg() |
| `governance_mode` | text | NOT NULL, default collaborative |
| `selected_integrations` | jsonb | |
| `selected_workflow_templates` | jsonb | |
| `onboarding_completed` | boolean | NOT NULL, default false |
| `onboarding_completed_at` | timestamp | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `org_ai_workforce_audit_log`
Immutable record of every workforce configuration change.

### `org_ai_workforce_outcomes`
Evidence-based record of every business outcome attributed to an AI agent.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `agent_id` | text NOT NULL | |
| `outcome_type` | text NOT NULL | revenue_generated/revenue_recovered/revenue_protected/appointment_booked/lead_recovered/client_retained/no_show_prevented/hours_saved/task_automated/workflow_executed/opportunity_identified |
| `outcome_category` | text NOT NULL | |
| `value` | doublePrecision | |
| `currency_value` | doublePrecision | |
| `source_record_id` | text | |
| `source_table` | text | |
| `confidence_score` | doublePrecision | |
| `attributed_at` | timestamp | |
| `created_at` | timestamp | |

### `org_ai_opportunities`
Actionable opportunities identified by AI agents.

### `org_ai_learning_events`
Immutable record of every learning signal (success, failure, recommendation accepted/rejected/deferred).

### `org_ai_workforce_memory`
Long-term organizational memory for preventing repeated recommendations.

### `org_ai_execution_plans`
Source of truth for every approved workforce action.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `agent_id` | text | |
| `recommendation_id` | text | |
| `title` | text NOT NULL | |
| `execution_type` | text NOT NULL | |
| `execution_status` | text | draft/awaiting_approval/approved/executing/completed/failed/cancelled |
| `approval_status` | text | pending/approved/rejected/auto_approved |
| `risk_level` | text | low/medium/high/critical |
| `estimated_value` | doublePrecision | |
| `actual_value` | doublePrecision | |
| `execution_steps` | jsonb | |
| `audit_trail` | jsonb | |
| `notes` | text | |
| `started_at` | timestamp | |
| `completed_at` | timestamp | |
| `created_at` | timestamp | |

### `org_ai_approval_rules`
Governs which agent actions can auto-execute vs. require human approval.

### `org_ai_experiments`
A/B testing framework for workflows, messages, and cadences.

### `workflow_optimization_recs`
Suggestions to improve specific workflows (require human approval before change).

---

## 22. Agent Marketplace (Phases 6–9)

### Phase 6: Marketplace Foundation

#### `agent_templates`
Marketplace-ready agent profiles. `agent_id` maps to `AGENT_IDENTITIES` key and has a UNIQUE constraint.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `agent_id` | text | NOT NULL, UNIQUE |
| `agent_name` | text NOT NULL | |
| `description` | text | |
| `department` | text | |
| `capabilities` | jsonb | |
| `required_integrations` | jsonb | |
| `supported_industries` | jsonb | |
| `benchmark_metrics` | jsonb | |
| `average_roi` | doublePrecision | |
| `average_success_rate` | doublePrecision | |
| `average_hours_saved` | doublePrecision | |
| `average_trust_score` | doublePrecision | |
| `average_revenue_influenced` | doublePrecision | |
| `benchmark_score` | doublePrecision | |
| `certification_level` | text | uncertified/certified/high_performer/elite_performer/platform_recommended |
| `installation_count` | integer | |
| `version` | text | default "1.0.0" |
| `maintainer` | text | default "TrainEfficiency" |
| `status` | text | NOT NULL, default active |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `agent_benchmarks`
Rolling benchmark snapshots (no org-identifying data stored).

#### `org_installed_agents`
Agent installations per org with governance policy.

#### `agent_certifications`
Certification records for agents.

#### `industry_benchmarks`
Anonymized cross-org industry-level benchmarks.

#### `agent_versions`
Version history with rollback support.

#### `cross_org_learning_events`
Anonymized cross-org learning signals for benchmark improvement.

### Phase 7: Developer Platform

#### `developer_accounts`
Developer registration for agent builders.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `user_id` | text | |
| `org_id` | text | |
| `display_name` | text NOT NULL | |
| `email` | text | |
| `bio` | text | |
| `status` | text | active/suspended/pending |
| `total_installs` | integer | |
| `total_revenue` | doublePrecision | |
| `lifetime_revenue` | doublePrecision | |
| `agents_published` | integer | |
| `revenue_share_rate` | doublePrecision | default 0.30 (30%) |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `agent_submissions`
Developer submission workflow: Draft → Submitted → Under Review → Approved → Published.

#### `agent_revenue_events`
Revenue events per agent for developer royalty attribution.

#### `developer_payouts`
Payout records (infrastructure only; no payment processing yet).

#### `agent_reviews`
Org-submitted agent reviews (rating, outcome/trust/ROI scores, ease of use, business impact, reliability).

#### `agent_permissions`
Required permission declarations; orgs explicitly grant them.

#### `agent_reputation`
Composite reputation score from all quality signals.

### Phase 8: Ecosystem

#### `white_label_agents`
Org-cloned private agents with custom branding and rules.

#### `agent_lifecycle_events`
Full lifecycle tracking: installed → active → upgraded → deprecated → archived → removed.

#### `agent_runtimes`
Isolated execution environments per installed agent per org.

#### `agent_memories`
Per-agent memory store (learned preferences, patterns, org-specific context).

#### `developer_royalty_accounts`
Developer royalty balance tracking (balance, lifetime earned/paid, pending).

#### `royalty_distributions`
Revenue split records (70% platform / 30% developer default).

#### `agent_verification_reviews`
Pre-publication security, governance, performance, benchmark, and permission reviews.

#### `agent_case_studies`
Social proof — documented org outcomes per agent.

#### `agent_trials`
7/14/30-day trials before committing to install.

#### `agent_upgrade_paths`
Controls how and when installed agents receive version upgrades.

---

## 23. Beta Program Infrastructure

### `beta_programs`
Beta program definitions with target participant counts by role.

### `beta_participants`
Beta program participants with engagement tracking.

### `beta_feedback`
Structured feedback submissions from beta participants.

### `beta_invites`
Invite tracking with activation status.

### `in_app_feedback`
General in-app feedback/bug reports from any user.

---

## 24. Attendance Tracker

A standalone attendance tracking module with public QR code check-in.

### `attendance_programs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `organization_id` | varchar NOT NULL | Tenant scope |
| `program_id` | varchar | NOT NULL, UNIQUE |
| `description` | text | |
| `location` | varchar | |
| `start_date` | varchar | |
| `end_date` | varchar | |
| `active` | boolean | NOT NULL, default true |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `attendance_program_fields`
Custom form fields per attendance program.

### `attendance_reward_tiers`
Visit-count thresholds that trigger rewards.

### `attendance_qr_codes`
QR code records linking program to public check-in URL via `public_slug`.

### `attendance_records`
Individual check-in records (athlete email, sport, school, grad year, visit number).

### `attendance_rewards_earned`
Records when athletes reach reward tier visit counts.

### `attendance_email_history`
Email delivery audit trail for attendance notifications.

---

## 25. Adaptive Workflow Engine (Athlete-Facing)

### `adaptive_workflows`
Athlete-facing automation workflows (triggered by athlete events like readiness drops).

### `adaptive_workflow_steps`
Step definitions within an adaptive workflow.

### `adaptive_workflow_runs`
Per-athlete execution records for adaptive workflows.

### `adaptive_followups`
Scheduled follow-up actions created by adaptive workflows.

---

## 26. Communication Automation Engine

### `communication_campaigns`
Email/SMS campaign definitions.

### `communication_messages`
Individual messages sent via campaigns.

### `communication_preferences`
Per-user, per-org channel preferences (email, SMS, in-app, guardian, quiet hours).

### `communication_templates`
Reusable message templates.

---

## 27. Org AI Integrations & Settings

### `org_ai_integrations`
Per-org AI provider integrations (e.g., TrainChat provider config).

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `org_id` | varchar NOT NULL | |
| `provider` | varchar NOT NULL | e.g., "trainchat" |
| `api_key_encrypted` | text | |
| `api_base_url` | text | |
| `is_active` | boolean | NOT NULL, default false |
| `last_tested_at` | timestamp | |
| `last_success_at` | timestamp | |
| `last_error` | text | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

---

## 28. Software Improvement Tasks

### `software_improvement_tasks`
Codex-ready engineering tasks generated by the Software Improvement Agent. No automatic code execution.

| Column | Type | Notes |
|--------|------|-------|
| `id` | varchar PK | |
| `organization_id` | varchar NOT NULL | |
| `source_agent` | varchar NOT NULL | |
| `source_type` | varchar NOT NULL | |
| `source_ref_id` | varchar | |
| `title` | varchar(512) NOT NULL | |
| `problem_summary` | text NOT NULL | |
| `business_context` | text | |
| `affected_area` | varchar(256) | |
| `suspected_files` | text | |
| `reproduction_steps` | text | |
| `expected_behavior` | text | |
| `constraints` | text | |
| `acceptance_checks` | text | |
| `severity` | varchar(32) | NOT NULL, default medium |
| `priority` | integer | NOT NULL, default 50 |
| `status` | enum | NOT NULL, default detected — detected/triaged/ready_for_codex/sent_to_codex/in_progress/needs_review/merged/rejected/archived/github_issue_draft_requested/github_issue_created |
| `codex_prompt` | text | |
| `codex_status` | varchar(64) | |
| `codex_branch` | varchar(256) | |
| `codex_pr_url` | varchar(512) | |
| `github_issue_url` | varchar(512) | |
| `github_approval_queue_id` | varchar(256) | |
| `github_issue_draft` | jsonb | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |
| `completed_at` | timestamp | |

---

## 29. Agent Quality & Trust

### `agent_quality_scores`
Computed per-agent trust metrics across rolling windows (7/30/90 days).

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `agent_name` | text NOT NULL | |
| `communication_domain` | text | NOT NULL, default "all" |
| `window_days` | integer | NOT NULL — 7, 30, or 90 |
| `total_actions` | integer | |
| `approved_count` | integer | |
| `rejected_count` | integer | |
| `edited_count` | integer | |
| `failed_count` | integer | |
| `override_count` | integer | |
| `learning_conversion_count` | integer | |
| `approval_rate` | doublePrecision | 0.0–1.0 |
| `rejection_rate` | doublePrecision | |
| `edit_rate` | doublePrecision | |
| `failure_rate` | doublePrecision | |
| `learning_conversion_rate` | doublePrecision | |
| `average_confidence` | doublePrecision | |
| `quality_score` | doublePrecision | |
| `score_delta` | doublePrecision | |
| `trust_tier` | text | NOT NULL, default training — training/assisted/trusted/high_trust/restricted |
| `rejection_spike` | boolean | NOT NULL, default false |
| `window_start` | timestamp | |
| `computed_at` | timestamp | default now |

**Unique index:** `(org_id, agent_name, communication_domain, window_days)`.

> **Note:** `communication_domain` defaults to `'all'` (not NULL) to satisfy the UNIQUE constraint.

### `agent_trust_overrides`
Admin-set manual tier overrides that take precedence over computed tiers.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | |
| `org_id` | text NOT NULL | |
| `agent_name` | text NOT NULL | |
| `communication_domain` | text | NOT NULL, default "all" |
| `override_tier` | text NOT NULL | training/assisted/trusted/high_trust/restricted |
| `reason` | text | |
| `overridden_by` | text | |
| `created_at` | timestamp | |

**Unique index:** `(org_id, agent_name, communication_domain)`.

---

## 30. Chat (TrainChat)

**Source:** `shared/models/chat.ts`

### `conversations`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | serial | PRIMARY KEY | Integer autoincrement (not UUID) |
| `title` | text | NOT NULL | |
| `created_at` | timestamp | NOT NULL, default CURRENT_TIMESTAMP | |

### `messages`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | serial | PRIMARY KEY | Integer autoincrement |
| `conversation_id` | integer | NOT NULL, FK → conversations.id CASCADE DELETE | |
| `role` | text | NOT NULL | user/assistant/system |
| `content` | text | NOT NULL | |
| `created_at` | timestamp | NOT NULL, default CURRENT_TIMESTAMP | |

> **Note:** `conversations` and `messages` use `serial` (integer) primary keys, not UUIDs. This is the only Drizzle-defined exception to the UUID pattern.

---

## Appendix A: Tables Created Outside Drizzle Schema

The following tables exist in the live database but are **not defined in `shared/schema.ts`**. They are created by service files via raw `db.execute(sql\`...\`)` calls at startup or first use. Drizzle ORM cannot type-check or migrate these tables automatically.

| Table Name | Created In | Purpose |
|------------|------------|---------|
| `outbound_send_fingerprints` | `server/email.ts` (Sprint 4) | Email deduplication — prevents duplicate sends |
| `outbound_email_audit_log` | `server/services/agentmail-send-guard.ts` | Audit log for blocked/allowed sends |
| `hermes_learnings` | `server/hermes-routes.ts` or Hermes service | Hermes learning engine entries |
| `execution_events` | Hermes Sprint 3 | Execution layer event store |
| `coordination_decisions` | Hermes Sprint 3 | Cross-agent coordination records |
| `agent_action_registry` | Hermes Sprint 3 | Agent action catalog |
| `conflict_alerts` | Hermes Sprint 3 | Conflict detection alerts |
| `business_forecasts` | `server/services/forecast-engine.ts` | Business forecasting records |
| `risk_signals` | `server/services/forecast-engine.ts` | Risk signal table (CEO Heartbeat reads this directly) |
| `opportunity_signals` | `server/services/forecast-engine.ts` | Opportunity signal records |
| `scenario_simulations` | `server/services/forecast-engine.ts` | Simulation records |
| `strategic_plans` | `server/services/forecast-engine.ts` | Strategic planning records |
| `forecast_accuracy` | `server/services/forecast-engine.ts` | Forecast accuracy tracking |
| `business_twin_state` | `server/services/forecast-engine.ts` | Business OS state |
| `decision_trust_registry` | `server/services/autonomy-scoring-service.ts` | Trust-based autonomy scoring |
| `autonomous_action_queue` | Autonomy Trust Layer (no Drizzle export) | Auto-execution queue — always raw SQL |
| `autonomy_overrides` | Autonomy Trust Layer | Manual autonomy overrides |
| `composio_action_log` | `server/composio-service.ts` | Composio external tool action log |
| `composio_hermes_events` | `server/composio-hermes-emitter.ts` | Composio events forwarded to Hermes |
| `agent_mail_followups` | `server/services/agentmail-followup-service.ts` | AgentMail follow-up sequence table |

> **Warning:** The `autonomous_action_queue` table has no Drizzle export and must always be queried with raw SQL. See memory file `autonomy-trust-phase4.md`.

---

## Architecture Discrepancies

The following discrepancies were found between the CLAUDE.md documentation and the verified source files:

### 1. Schema File Location — CRITICAL

| CLAUDE.md States | Actual Location | Verified By |
|-----------------|-----------------|-------------|
| `server/db/schema.ts` | `shared/schema.ts` | `drizzle.config.ts`: `schema: "./shared/schema.ts"` |

**Impact:** Any developer following CLAUDE.md to find the schema will look in the wrong place. The file `server/db/schema.ts` does not exist.

### 2. Sub-Model Files Not Documented

CLAUDE.md makes no mention of `shared/models/auth.ts` or `shared/models/chat.ts`, which are re-exported from `shared/schema.ts` and contain the `sessions`, `users`, `password_reset_tokens`, `conversations`, and `messages` tables. These are mandatory tables (Replit Auth requires `sessions` and `users`).

### 3. Tables Created Outside Drizzle

CLAUDE.md's architecture description does not mention the ~20 tables created via raw `db.execute(sql\`...\`)` calls in service files (see Appendix A). These tables are invisible to Drizzle migrations and `drizzle-kit push`.

### 4. `orgAiRisks` Does Not Exist

Memory file records: CLAUDE.md or CEO Heartbeat code referenced `orgAiRisks` but this table does not exist in the schema. The `risk_signals` table from `forecast-engine.ts` (raw SQL, Appendix A) is the correct source.

### 5. Primary Key Type Inconsistency

The schema uses two PK patterns (`varchar` + `gen_random_uuid()` vs. `text` + `crypto.randomUUID()`). This is internally consistent but undocumented. The older pattern is `varchar`; newer tables use `text`.

### 6. `bookings.booking_status` Enum is Uppercase

The booking status values are uppercase (`PENDING`, `CONFIRMED`, `CANCELLED`, `COMPLETED`), not lowercase. Raw SQL inserts must use uppercase.

---

## Recommended CLAUDE.md Updates

1. **Update schema path:** Change all references from `server/db/schema.ts` to `shared/schema.ts`.

2. **Add sub-model references:** Add `shared/models/auth.ts` (sessions, users, password_reset_tokens) and `shared/models/chat.ts` (conversations, messages) to the "Where things live" section.

3. **Document raw-SQL tables:** Add a note in the Architecture section that ~20 tables are created via `db.execute()` in service files and are not part of the Drizzle migration graph.

4. **Remove `orgAiRisks` references:** Replace with `risk_signals` (raw SQL table in forecast-engine.ts).

5. **Add booking_status uppercase note:** Document that `bookings.booking_status` uses uppercase enum values.

6. **Add `user_profiles` auth note:** Explicitly document that auth guards read `role` and `organization_id` from `user_profiles`, not `users`.

---

## Files Reviewed

| File | Lines | Role |
|------|-------|------|
| `shared/schema.ts` | 5,334 | Primary schema source — all lines read |
| `shared/models/auth.ts` | 60 | Auth sub-model (sessions, users, password_reset_tokens) |
| `shared/models/chat.ts` | 34 | Chat sub-model (conversations, messages) |
| `drizzle.config.ts` | ~15 | Confirms schema path and DB config |
| `CLAUDE.md` | 3,239 | Architectural reference for reconciliation |
| `docs/version-2-roadmap.md` | — | Generation order and reconciliation rules |
| `.agents/memory/MEMORY.md` + topic files | — | Historical implementation decisions |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Table names | **High** | All 5,334 lines of schema read; confirmed against Drizzle exports |
| Column names and types | **High** | Directly transcribed from Drizzle table definitions |
| Primary key patterns | **High** | Two confirmed patterns; documented |
| Raw-SQL tables (Appendix A) | **Medium** | Derived from memory topic files and code references; not directly verified against each service file |
| Foreign key relationships | **Medium** | Implied by column naming convention (`_id` suffix); explicit `.references()` calls sparse in this schema |
| Table row counts / seeded data | **Low** | Not verified — requires live DB query |
| Tables created by `createTables()` functions | **Medium** | Attendance tables confirmed; other dynamic tables rely on memory file accuracy |

**Overall Document Confidence:** High for Drizzle-defined tables; Medium for raw-SQL tables in Appendix A.
