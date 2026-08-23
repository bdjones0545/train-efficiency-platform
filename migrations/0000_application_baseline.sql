-- Generated from shared/schema.ts with the repository-pinned Drizzle exporter.
-- This baseline intentionally stops immediately before the ordered feature
-- migrations below it. In particular, 0005 owns the organization preference
-- unsubscribe token column and index.
CREATE TYPE "agent_action_status" AS ENUM('pending', 'sent', 'responded', 'booked', 'ignored', 'failed');
CREATE TYPE "agent_job_status" AS ENUM('requested', 'dispatching', 'queued', 'running', 'requires_approval', 'completed', 'failed', 'cancelled', 'timed_out', 'blocked_by_policy');
CREATE TYPE "agent_pending_action_status" AS ENUM('pending', 'completed', 'cancelled', 'expired');
CREATE TYPE "booking_status" AS ENUM('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED');
CREATE TYPE "campaign_status" AS ENUM('active', 'paused', 'completed', 'stopped');
CREATE TYPE "cashout_status" AS ENUM('REQUESTED', 'PAID', 'DENIED');
CREATE TYPE "closeout_period_type" AS ENUM('weekly', 'monthly', 'custom');
CREATE TYPE "closeout_status" AS ENUM('draft', 'open', 'closed', 'reopened');
CREATE TYPE "credit_event_type" AS ENUM('subscription_renewal', 'redemption_debit', 'cancellation_reversal', 'manual_adjustment', 'refund', 'admin_override');
CREATE TYPE "deal_activity_type" AS ENUM('deal_created', 'status_changed', 'note_added', 'email_sent', 'call_logged', 'follow_up_scheduled', 'follow_up_completed', 'ai_action', 'won', 'lost', 'manual');
CREATE TYPE "deal_status" AS ENUM('new', 'contacted', 'interested', 'call_scheduled', 'proposal_sent', 'negotiating', 'won', 'lost');
CREATE TYPE "financial_event_failure_status" AS ENUM('pending', 'retrying', 'resolved', 'ignored', 'failed');
CREATE TYPE "follow_up_status" AS ENUM('pending', 'processing', 'retrying', 'sent', 'failed', 'cancelled', 'skipped');
CREATE TYPE "kevin_approval_mode" AS ENUM('disabled', 'observe', 'recommend', 'draft', 'require_approval', 'auto');
CREATE TYPE "kevin_context_status" AS ENUM('success', 'empty', 'timeout', 'disabled', 'unavailable', 'failed', 'blocked_loop');
CREATE TYPE "kevin_event_status" AS ENUM('pending', 'processing', 'sent', 'failed', 'dead_lettered');
CREATE TYPE "kevin_outcome_type" AS ENUM('accepted', 'modified', 'rejected', 'dismissed', 'no_action', 'successful', 'unsuccessful', 'unknown');
CREATE TYPE "kevin_risk_class" AS ENUM('low', 'medium', 'high', 'critical');
CREATE TYPE "kevin_signal_status" AS ENUM('pending', 'routed', 'actioned', 'dismissed', 'duplicate', 'rejected');
CREATE TYPE "media_section" AS ENUM('hero', 'training_showcase', 'facility', 'coaches', 'testimonials', 'results');
CREATE TYPE "media_type" AS ENUM('image', 'video');
CREATE TYPE "payment_method" AS ENUM('WALLET', 'VENMO', 'CASH');
CREATE TYPE "payout_status" AS ENUM('PENDING', 'SENT', 'FAILED');
CREATE TYPE "payout_type" AS ENUM('percentage', 'fixed', 'hourly', 'none');
CREATE TYPE "prospect_outreach_status" AS ENUM('New', 'Needs Review', 'Approved', 'Contacted', 'Replied', 'Not Interested', 'Do Not Contact');
CREATE TYPE "quote_status" AS ENUM('DRAFT', 'SENT', 'PAID', 'EXPIRED');
CREATE TYPE "reply_classification" AS ENUM('interested', 'not_interested', 'ask_info', 'referral', 'wrong_contact', 'out_of_office', 'unknown');
CREATE TYPE "retention_risk_level" AS ENUM('low', 'moderate', 'high', 'critical');
CREATE TYPE "revenue_ledger_event_type" AS ENUM('payment_received', 'revenue_recognized', 'deferred_revenue_created', 'deferred_revenue_released', 'coach_compensation_accrued', 'coach_compensation_paid', 'refund_issued', 'cancellation_reversal', 'manual_adjustment');
CREATE TYPE "revenue_recognition" AS ENUM('at_booking', 'at_purchase', 'none');
CREATE TYPE "user_role" AS ENUM('CLIENT', 'COACH', 'ADMIN', 'STAFF');
CREATE TYPE "service_category" AS ENUM('paid', 'intro', 'internal', 'meeting', 'membership', 'package_redemption', 'comp');
CREATE TYPE "session_type" AS ENUM('1_ON_1', 'GROUP', 'SEMI_PRIVATE', 'TEAM_TRAINING', 'ASSESSMENT', 'RECOVERY');
CREATE TYPE "software_improvement_status" AS ENUM('detected', 'triaged', 'ready_for_codex', 'sent_to_codex', 'in_progress', 'needs_review', 'merged', 'rejected', 'archived', 'github_issue_draft_requested', 'github_issue_created');
CREATE TYPE "subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'none');
CREATE TYPE "team_outreach_event_type" AS ENUM('draft_created', 'approved', 'sent', 'failed', 'replied', 'bounced', 'unsubscribed', 'marked_do_not_contact', 'research_run', 'skipped', 'settings_updated', 'manual_research_started', 'manual_research_completed', 'recurring_research_started', 'recurring_research_completed', 'recurring_research_failed', 'contact_enriched');
CREATE TYPE "training_type_enum" AS ENUM('STRENGTH', 'SPEED');
CREATE TYPE "email_trigger_action_type" AS ENUM('send_initial_email', 'send_follow_up', 'generate_draft', 'send_response');
CREATE TYPE "email_trigger_block_reason" AS ENUM('DNC', 'OPTED_OUT', 'COOLDOWN_ACTIVE', 'DAILY_LIMIT_REACHED', 'AUTO_EXEC_LIMIT_REACHED', 'LOW_CONFIDENCE', 'HIGH_RISK', 'MISSING_EMAIL', 'DUPLICATE_CONTACT', 'INVALID_STAGE', 'DEAL_ACTIVE_BLOCK', 'AGENT_DISABLED', 'NO_ELIGIBLE_PROSPECTS');
CREATE TYPE "email_trigger_source" AS ENUM('cron_8_30am', 'hourly_follow_up_cron', 'auto_exec_hook', 'user_click', 'api_call');
CREATE TYPE "email_trigger_type" AS ENUM('daily_outreach', 'follow_up_cron', 'auto_execution', 'manual', 'system_event');
CREATE TYPE "wallet_tx_type" AS ENUM('CREDIT', 'DEBIT');
CREATE TABLE "adaptive_followups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"intervention_id" varchar,
	"workflow_run_id" varchar,
	"followup_date" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"notes" text,
	"coach_user_id" varchar,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "adaptive_workflow_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"trigger_event" varchar(200),
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE "adaptive_workflow_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" varchar NOT NULL,
	"step_order" integer DEFAULT 1 NOT NULL,
	"action_type" varchar(100) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "adaptive_workflows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"trigger_type" varchar(100) NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"template_key" varchar(100),
	"created_by_user_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "admin_action_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"admin_user_id" text NOT NULL,
	"admin_email" text,
	"action_type" text NOT NULL,
	"target_table" text,
	"target_id" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"ip_address" text,
	"user_agent" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_action_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"action_type" varchar NOT NULL,
	"description" text NOT NULL,
	"payload" jsonb,
	"executed_at" timestamp DEFAULT now(),
	"undone" boolean DEFAULT false
);

CREATE TABLE "agent_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"client_id" varchar,
	"coach_id" varchar,
	"action_type" varchar NOT NULL,
	"action_sub_type" varchar,
	"created_at" timestamp DEFAULT now(),
	"related_slot" jsonb,
	"message_content" jsonb,
	"status" "agent_action_status" DEFAULT 'pending',
	"booking_id" varchar,
	"outcome_value_cents" integer,
	"follow_up_at" timestamp,
	"follow_up_count" integer DEFAULT 0,
	"client_name" varchar,
	"notes" text,
	"auto_sent" boolean DEFAULT false,
	"auto_reason" text,
	"variation_type" varchar,
	"scheduled_for" timestamp,
	"campaign_id" varchar,
	"campaign_step" integer
);

CREATE TABLE "agent_autonomy_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"action_id" text,
	"lead_id" text,
	"deal_id" text,
	"action_type" text NOT NULL,
	"decision" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"policy_version" text DEFAULT '1.0.0' NOT NULL,
	"settings_snapshot" jsonb,
	"created_at" timestamp DEFAULT now(),
	"executed_at" timestamp,
	"result" text,
	"error_message" text
);

CREATE TABLE "agent_autonomy_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"message_type" text NOT NULL,
	"autonomy_level" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"communication_domain" text DEFAULT 'athlete_lead'
);

CREATE TABLE "agent_benchmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_template_id" text,
	"agent_id" text,
	"benchmark_type" text NOT NULL,
	"industry" text,
	"sample_size" integer DEFAULT 0,
	"success_rate" double precision DEFAULT 0,
	"revenue_influence" double precision DEFAULT 0,
	"hours_saved" double precision DEFAULT 0,
	"roi" double precision DEFAULT 0,
	"trust_score" double precision DEFAULT 0,
	"forecast_accuracy" double precision DEFAULT 0,
	"recommendation_accuracy" double precision DEFAULT 0,
	"opportunity_conversion" double precision DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_capability_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_type" text NOT NULL,
	"capability_name" text NOT NULL,
	"capability_category" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"requires_approval" boolean DEFAULT true,
	"max_autonomy_level" text DEFAULT 'supervised' NOT NULL,
	"minimum_confidence_score" double precision DEFAULT 0.75,
	"allowed_risk_levels" text[] DEFAULT '{"low"}',
	"requires_human_review" boolean DEFAULT true,
	"escalation_required" boolean DEFAULT false,
	"execution_limits" jsonb,
	"allowed_tools" jsonb,
	"restricted_tools" jsonb,
	"notes" text,
	"created_by" text DEFAULT 'system',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_case_studies" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"org_id" text NOT NULL,
	"org_type" text,
	"problem" text NOT NULL,
	"solution" text NOT NULL,
	"outcome" text NOT NULL,
	"revenue_impact" double precision DEFAULT 0,
	"time_saved" double precision DEFAULT 0,
	"trust_score" double precision DEFAULT 0,
	"verification_status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_certifications" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_template_id" text,
	"agent_id" text NOT NULL,
	"certification_level" text NOT NULL,
	"roi_score" double precision DEFAULT 0,
	"trust_score" double precision DEFAULT 0,
	"success_rate_score" double precision DEFAULT 0,
	"sample_size" integer DEFAULT 0,
	"forecast_accuracy_score" double precision DEFAULT 0,
	"opportunity_conversion_score" double precision DEFAULT 0,
	"achieved_at" timestamp DEFAULT now(),
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_communication_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"gmail_action_id" text,
	"feedback_id" text,
	"communication_domain" text DEFAULT 'athlete_lead' NOT NULL,
	"message_type" text,
	"recipient_email" text,
	"recipient_name" text,
	"lead_id" text,
	"prospect_id" text,
	"deal_id" text,
	"applicant_id" text,
	"sent_at" timestamp,
	"opened_at" timestamp,
	"replied_at" timestamp,
	"meeting_booked_at" timestamp,
	"proposal_requested_at" timestamp,
	"proposal_sent_at" timestamp,
	"proposal_accepted_at" timestamp,
	"contract_signed_at" timestamp,
	"hired_at" timestamp,
	"booked_session_at" timestamp,
	"converted_at" timestamp,
	"lost_at" timestamp,
	"outcome_status" text DEFAULT 'sent' NOT NULL,
	"revenue_cents" integer DEFAULT 0,
	"outcome_source" text DEFAULT 'manual_update',
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_draft_coaching_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"communication_domain" text DEFAULT 'general' NOT NULL,
	"rule_type" text DEFAULT 'instruction' NOT NULL,
	"rule_text" text NOT NULL,
	"authored_by" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_execution_locks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lock_key" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"workflow_run_id" text,
	"locked_by" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "agent_execution_locks_lock_key_unique" UNIQUE("lock_key")
);

CREATE TABLE "agent_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"stripe_invoice_id" varchar,
	"stripe_customer_id" varchar,
	"tool_call_id" varchar,
	"workflow_run_id" varchar,
	"client_id" varchar,
	"amount_cents" integer,
	"description" text,
	"status" varchar DEFAULT 'draft',
	"due_date" timestamp,
	"stripe_invoice_url" varchar,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"task_type" text NOT NULL,
	"status" "agent_job_status" DEFAULT 'requested' NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"request_payload" jsonb,
	"result_payload" jsonb,
	"error_code" text,
	"error_message" text,
	"remote_task_id" text,
	"idempotency_key" text NOT NULL,
	"correlation_id" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "agent_lifecycle_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"org_id" text,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"notes" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"org_id" text NOT NULL,
	"learned_preferences" jsonb,
	"successful_patterns" jsonb,
	"failed_patterns" jsonb,
	"org_specific_context" jsonb,
	"workflow_history" jsonb,
	"recommendation_history" jsonb,
	"memory_version" integer DEFAULT 1,
	"last_updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_message_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"lead_id" text,
	"agent_name" text,
	"message_type" text,
	"original_subject" text,
	"original_body" text,
	"edited_subject" text,
	"edited_body" text,
	"decision" text NOT NULL,
	"rejection_reason" text,
	"quality_rating" integer,
	"reviewer_notes" text,
	"reviewed_by" text,
	"reviewed_at" timestamp DEFAULT now(),
	"lead_context_json" jsonb,
	"outcome" text,
	"created_at" timestamp DEFAULT now(),
	"coaching_feedback_text" text,
	"feedback_tags" jsonb,
	"extracted_preferences" jsonb,
	"extracted_avoid_rules" jsonb,
	"extracted_do_rules" jsonb,
	"applies_to_lead_type" text,
	"applies_to_program" text,
	"preference_strength" text,
	"should_apply_globally" boolean DEFAULT false,
	"communication_domain" text DEFAULT 'athlete_lead',
	"outcome_data" jsonb,
	"applied_to_future_runs" boolean DEFAULT false
);

CREATE TABLE "agent_message_learning_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source_feedback_id" text,
	"rule_type" text NOT NULL,
	"rule_text" text NOT NULL,
	"message_type" text,
	"lead_type" text,
	"program" text,
	"applies_globally" boolean DEFAULT false,
	"confidence" text DEFAULT '0.80',
	"weight" integer DEFAULT 1,
	"status" text DEFAULT 'active',
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"last_applied_at" timestamp,
	"times_applied" integer DEFAULT 0,
	"success_count" integer DEFAULT 0,
	"rejection_count" integer DEFAULT 0,
	"communication_domain" text DEFAULT 'athlete_lead'
);

CREATE TABLE "agent_message_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"org_id" text NOT NULL,
	"revision_number" integer DEFAULT 1 NOT NULL,
	"original_subject" text,
	"original_body" text,
	"revised_subject" text,
	"revised_body" text,
	"feedback_used" text,
	"created_at" timestamp DEFAULT now(),
	"created_by" text
);

CREATE TABLE "agent_operating_timeline" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"heartbeat_id" text,
	"agent_name" text NOT NULL,
	"system_name" text,
	"action_type" text NOT NULL,
	"action_status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 50,
	"communication_domain" text,
	"related_entity_type" text,
	"related_entity_id" text,
	"summary" text,
	"decision_reason" text,
	"requires_approval" boolean DEFAULT false,
	"approval_status" text,
	"executed_at" timestamp,
	"outcome_status" text,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_pending_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"org_id" varchar,
	"action_type" varchar NOT NULL,
	"normalized_args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "agent_pending_action_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(128),
	"provider_message_sid" varchar,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	CONSTRAINT "agent_pending_actions_idempotency_key_unique" UNIQUE("idempotency_key")
);

CREATE TABLE "agent_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"org_id" text,
	"permission_type" text NOT NULL,
	"granted" boolean DEFAULT false,
	"granted_at" timestamp,
	"risk_level" text DEFAULT 'low',
	"requires_approval" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_quality_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"communication_domain" text DEFAULT 'all' NOT NULL,
	"window_days" integer NOT NULL,
	"total_actions" integer DEFAULT 0 NOT NULL,
	"approved_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"edited_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"override_count" integer DEFAULT 0 NOT NULL,
	"learning_conversion_count" integer DEFAULT 0 NOT NULL,
	"approval_rate" double precision,
	"rejection_rate" double precision,
	"edit_rate" double precision,
	"failure_rate" double precision,
	"learning_conversion_rate" double precision,
	"average_confidence" double precision,
	"quality_score" double precision,
	"score_delta" double precision,
	"trust_tier" text DEFAULT 'training' NOT NULL,
	"rejection_spike" boolean DEFAULT false NOT NULL,
	"window_start" timestamp,
	"computed_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_recommendations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"agent_type" varchar NOT NULL,
	"cross_agent_types" text[] DEFAULT '{}',
	"title" text NOT NULL,
	"description" text NOT NULL,
	"reason" text NOT NULL,
	"entity_type" varchar,
	"entity_id" varchar,
	"entity_name" varchar,
	"severity" varchar DEFAULT 'medium' NOT NULL,
	"estimated_impact" integer DEFAULT 0,
	"priority_score" integer DEFAULT 50,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"action_type" varchar,
	"executed_at" timestamp,
	"dismissed_at" timestamp,
	"outcome_type" varchar,
	"outcome_value" integer DEFAULT 0,
	"outcome_logged_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"orchestrator_run_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_reputation" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"reputation_score" double precision DEFAULT 0,
	"marketplace_rank" integer DEFAULT 0,
	"trust_tier" text DEFAULT 'New to Market',
	"recommendation_score" double precision DEFAULT 0,
	"avg_rating" double precision DEFAULT 0,
	"review_count" integer DEFAULT 0,
	"roi_contribution" double precision DEFAULT 0,
	"trust_contribution" double precision DEFAULT 0,
	"certification_contribution" double precision DEFAULT 0,
	"adoption_contribution" double precision DEFAULT 0,
	"benchmark_stability_contribution" double precision DEFAULT 0,
	"computed_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "agent_reputation_agent_id_unique" UNIQUE("agent_id")
);

CREATE TABLE "agent_revenue_events" (
	"id" text PRIMARY KEY NOT NULL,
	"developer_id" text,
	"agent_id" text NOT NULL,
	"org_id" text NOT NULL,
	"event_type" text NOT NULL,
	"amount" double precision DEFAULT 0,
	"royalty_amount" double precision DEFAULT 0,
	"attribution" jsonb,
	"period" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"org_id" text NOT NULL,
	"rating" double precision NOT NULL,
	"review" text,
	"outcome_score" double precision DEFAULT 0,
	"trust_score" double precision DEFAULT 0,
	"roi_score" double precision DEFAULT 0,
	"ease_of_use" integer DEFAULT 3,
	"business_impact" integer DEFAULT 3,
	"reliability" integer DEFAULT 3,
	"verified_usage" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_rule_effectiveness" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"communication_domain" text DEFAULT 'athlete_lead' NOT NULL,
	"message_type" text,
	"times_applied" integer DEFAULT 0,
	"sent_count" integer DEFAULT 0,
	"reply_count" integer DEFAULT 0,
	"meeting_count" integer DEFAULT 0,
	"proposal_count" integer DEFAULT 0,
	"conversion_count" integer DEFAULT 0,
	"hired_count" integer DEFAULT 0,
	"lost_count" integer DEFAULT 0,
	"revenue_cents" integer DEFAULT 0,
	"effectiveness_score" double precision DEFAULT 0,
	"last_calculated_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_runtimes" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"org_id" text NOT NULL,
	"runtime_version" text DEFAULT '1.0.0',
	"memory_scope" jsonb,
	"tool_scope" jsonb,
	"execution_count" integer DEFAULT 0,
	"success_count" integer DEFAULT 0,
	"failure_count" integer DEFAULT 0,
	"status" text DEFAULT 'active' NOT NULL,
	"last_active_at" timestamp,
	"isolation_level" text DEFAULT 'standard',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_signals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"agent_type" varchar NOT NULL,
	"signal_type" varchar NOT NULL,
	"entity_type" varchar,
	"entity_id" varchar,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" varchar DEFAULT 'medium' NOT NULL,
	"score" integer DEFAULT 50,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"orchestrator_run_id" varchar,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"developer_id" text NOT NULL,
	"agent_template_id" text,
	"agent_definition" jsonb,
	"submission_status" text DEFAULT 'draft' NOT NULL,
	"review_notes" text,
	"benchmark_results" jsonb,
	"governance_review" jsonb,
	"submitted_at" timestamp,
	"reviewed_at" timestamp,
	"approved_at" timestamp,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"description" text,
	"department" text,
	"capabilities" jsonb,
	"required_integrations" jsonb,
	"supported_industries" jsonb,
	"benchmark_metrics" jsonb,
	"average_roi" double precision DEFAULT 0,
	"average_success_rate" double precision DEFAULT 0,
	"average_hours_saved" double precision DEFAULT 0,
	"average_trust_score" double precision DEFAULT 0,
	"average_revenue_influenced" double precision DEFAULT 0,
	"benchmark_score" double precision DEFAULT 0,
	"certification_level" text DEFAULT 'uncertified',
	"installation_count" integer DEFAULT 0,
	"version" text DEFAULT '1.0.0',
	"maintainer" text DEFAULT 'TrainEfficiency',
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "agent_templates_agent_id_unique" UNIQUE("agent_id")
);

CREATE TABLE "agent_tool_calls" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"agent_name" varchar NOT NULL,
	"tool_name" varchar NOT NULL,
	"target_type" varchar,
	"target_id" varchar,
	"target_name" varchar,
	"input_summary" text,
	"proposed_input" jsonb DEFAULT '{}'::jsonb,
	"reason" text,
	"confidence" double precision,
	"estimated_impact" integer,
	"requires_confirmation" boolean DEFAULT false,
	"confirmation_status" varchar DEFAULT 'auto',
	"confirmed_at" timestamp,
	"confirmed_by" varchar,
	"status" varchar DEFAULT 'pending',
	"result" jsonb DEFAULT '{}'::jsonb,
	"error" text,
	"execution_time_ms" integer,
	"source_recommendation_id" varchar,
	"source_revenue_action_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"executed_at" timestamp,
	"idempotency_key" varchar,
	"provider_message_id" varchar,
	"send_attempts" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" varchar
);

CREATE TABLE "agent_trials" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"org_id" text NOT NULL,
	"trial_duration_days" integer DEFAULT 14,
	"trial_start" timestamp DEFAULT now(),
	"trial_end" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"usage_count" integer DEFAULT 0,
	"roi_generated" double precision DEFAULT 0,
	"converted" boolean DEFAULT false,
	"converted_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_trust_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"communication_domain" text DEFAULT 'all' NOT NULL,
	"override_tier" text NOT NULL,
	"reason" text,
	"overridden_by" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_upgrade_paths" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"org_id" text NOT NULL,
	"current_version" text DEFAULT '1.0.0',
	"available_version" text,
	"release_channel" text DEFAULT 'stable',
	"upgrade_mode" text DEFAULT 'manual_approval',
	"auto_upgrade" boolean DEFAULT false,
	"last_upgraded_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_verification_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"security_review" jsonb,
	"governance_review" jsonb,
	"performance_review" jsonb,
	"benchmark_review" jsonb,
	"permission_review" jsonb,
	"verification_level" text DEFAULT 'unverified',
	"overall_score" double precision DEFAULT 0,
	"review_notes" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "agent_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_template_id" text,
	"agent_id" text NOT NULL,
	"version" text NOT NULL,
	"release_notes" text,
	"benchmark_changes" jsonb,
	"roi_delta" double precision DEFAULT 0,
	"trust_delta" double precision DEFAULT 0,
	"performance_changes" jsonb,
	"status" text DEFAULT 'stable' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "ai_revenue_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"prospect_id" varchar,
	"deal_id" varchar,
	"execution_log_id" varchar,
	"action_type" varchar NOT NULL,
	"action_source" varchar DEFAULT 'manual' NOT NULL,
	"outcome_status" varchar DEFAULT 'pending' NOT NULL,
	"outcome_value" integer DEFAULT 0,
	"outcome_source" varchar,
	"outcome_timestamp" timestamp,
	"time_to_outcome_hours" integer,
	"prospect_name" varchar,
	"sport" varchar,
	"attribution_role" varchar DEFAULT 'primary',
	"attribution_chain_id" varchar,
	"chain_position" integer DEFAULT 0,
	"credited_value" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "apex_recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"signal_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_name" text,
	"urgency" text DEFAULT 'medium' NOT NULL,
	"estimated_value_cents" integer DEFAULT 0,
	"reason_text" text,
	"recommended_action" text,
	"confidence_score" double precision,
	"stale_days" integer DEFAULT 0,
	"source_url" text,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"status_updated_at" timestamp,
	"status_updated_by" text,
	"dismiss_reason" text,
	"run_id" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "app_settings" (
	"key" varchar PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);

CREATE TABLE "athlete_ai_summaries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"coach_user_id" varchar NOT NULL,
	"summary_type" varchar NOT NULL,
	"source_snapshot" jsonb,
	"generated_text" text NOT NULL,
	"edited_text" text,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "athlete_context_objects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"current_program_id" varchar,
	"current_program_week" integer,
	"current_program_phase" varchar,
	"compliance_rate" integer,
	"readiness_trend" varchar DEFAULT 'unknown',
	"risk_level" varchar DEFAULT 'green',
	"last_30_day_readiness_trend" jsonb DEFAULT '[]'::jsonb,
	"recent_session_feedback" jsonb DEFAULT '[]'::jsonb,
	"recent_rpe_trend" jsonb DEFAULT '[]'::jsonb,
	"recent_prs" jsonb DEFAULT '[]'::jsonb,
	"missed_sessions" jsonb DEFAULT '[]'::jsonb,
	"injury_notes" jsonb DEFAULT '[]'::jsonb,
	"coach_notes" jsonb DEFAULT '[]'::jsonb,
	"intervention_history" jsonb DEFAULT '[]'::jsonb,
	"education_history" jsonb DEFAULT '[]'::jsonb,
	"risk_flags" jsonb DEFAULT '[]'::jsonb,
	"ai_summary" text,
	"last_refresh_trigger" varchar DEFAULT 'manual',
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "athlete_external_assets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"source_type" varchar NOT NULL,
	"source_url" text NOT NULL,
	"title" text,
	"thumbnail_url" text,
	"extracted_metadata" jsonb,
	"confidence_score" double precision DEFAULT 0,
	"status" varchar DEFAULT 'pending_review' NOT NULL,
	"approved_by_coach_id" varchar,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "athlete_guardian_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"guardian_user_id" varchar NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" varchar,
	"invite_email" varchar,
	"invite_token" varchar,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"activated_at" timestamp
);

CREATE TABLE "athlete_intelligence_alerts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"coach_user_id" varchar NOT NULL,
	"alert_type" varchar NOT NULL,
	"severity" varchar DEFAULT 'info' NOT NULL,
	"title" varchar NOT NULL,
	"summary" text,
	"metadata" jsonb,
	"source_url" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "athlete_intelligence_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"source_type" varchar NOT NULL,
	"source_url" text NOT NULL,
	"snapshot_hash" varchar NOT NULL,
	"snapshot_data" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "athlete_intervention_recommendations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"recommendation_type" varchar NOT NULL,
	"generated_by" varchar DEFAULT 'rules' NOT NULL,
	"title" varchar NOT NULL,
	"summary" text NOT NULL,
	"suggested_action" text,
	"related_pathway_id" varchar,
	"related_workout_id" varchar,
	"severity" varchar DEFAULT 'info' NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"coach_notes" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "athlete_memory_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"primary_sport" varchar,
	"secondary_sport" varchar,
	"position" varchar,
	"competition_level" varchar,
	"training_age_years" integer,
	"preferred_exercises" jsonb DEFAULT '[]'::jsonb,
	"disliked_exercises" jsonb DEFAULT '[]'::jsonb,
	"preferred_session_length_min" integer,
	"preferred_training_days" jsonb DEFAULT '[]'::jsonb,
	"movement_restrictions" jsonb DEFAULT '[]'::jsonb,
	"recurring_compensations" jsonb DEFAULT '[]'::jsonb,
	"technical_focus_areas" jsonb DEFAULT '[]'::jsonb,
	"coaching_cues_that_work" jsonb DEFAULT '[]'::jsonb,
	"normal_readiness_range" jsonb,
	"fatigue_patterns" text,
	"recovery_patterns" text,
	"stress_patterns" text,
	"exercises_that_progress_well" jsonb DEFAULT '[]'::jsonb,
	"exercises_that_stall" jsonb DEFAULT '[]'::jsonb,
	"high_response_stimuli" jsonb DEFAULT '[]'::jsonb,
	"low_response_stimuli" jsonb DEFAULT '[]'::jsonb,
	"historical_injuries" jsonb DEFAULT '[]'::jsonb,
	"recurring_pain_areas" jsonb DEFAULT '[]'::jsonb,
	"movement_red_flags" jsonb DEFAULT '[]'::jsonb,
	"coach_notes_summary" text,
	"coaching_history_summary" text,
	"last_coach_note_analyzed_at" timestamp,
	"trust_level" integer DEFAULT 0,
	"trust_level_reason" text,
	"memory_confidence" integer DEFAULT 0,
	"sessions_analyzed" integer DEFAULT 0,
	"last_synthesized_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "athlete_onboarding_checklists" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"lead_submission_id" varchar,
	"account_invite_sent" boolean DEFAULT false NOT NULL,
	"welcome_draft_queued" boolean DEFAULT false NOT NULL,
	"welcome_draft_approved" boolean DEFAULT false NOT NULL,
	"pail_context_seeded" boolean DEFAULT false NOT NULL,
	"guardian_linked" boolean DEFAULT false NOT NULL,
	"first_session_scheduled" boolean DEFAULT false NOT NULL,
	"program_assigned" boolean DEFAULT false NOT NULL,
	"payment_setup" boolean DEFAULT false NOT NULL,
	"waiver_completed" boolean DEFAULT false NOT NULL,
	"first_session_completed" boolean DEFAULT false NOT NULL,
	"next_best_action" text,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "athlete_public_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"source_name" varchar,
	"source_url" text,
	"source_title" text,
	"confidence_score" double precision DEFAULT 0,
	"extracted_data" jsonb,
	"approved_by_coach_id" varchar,
	"approved_at" timestamp,
	"status" varchar DEFAULT 'pending_review' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "athlete_risk_flags" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"flag_type" varchar NOT NULL,
	"severity" varchar DEFAULT 'info' NOT NULL,
	"title" varchar NOT NULL,
	"summary" text NOT NULL,
	"recommendation" text,
	"source_data" jsonb,
	"status" varchar DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp
);

CREATE TABLE "athlete_session_outcomes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"session_id" varchar NOT NULL,
	"program_id" varchar,
	"session_completed" boolean DEFAULT false,
	"session_skipped" boolean DEFAULT false,
	"session_modified" boolean DEFAULT false,
	"pr_achieved" boolean DEFAULT false,
	"exercises_with_pr" jsonb DEFAULT '[]'::jsonb,
	"readiness_change" integer,
	"soreness_change" integer,
	"pain_change" integer,
	"compliance_score" integer,
	"rpe_avg" integer,
	"exercises_completed" integer DEFAULT 0,
	"exercises_total" integer DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "athlete_status_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"status_score" integer DEFAULT 0 NOT NULL,
	"risk_level" varchar DEFAULT 'green' NOT NULL,
	"readiness_score" integer DEFAULT 0,
	"adherence_score" integer DEFAULT 0,
	"recovery_score" integer DEFAULT 0,
	"education_score" integer DEFAULT 0,
	"engagement_score" integer DEFAULT 0,
	"generated_at" timestamp DEFAULT now(),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "athlete_streaks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_completed_date" timestamp,
	"total_sessions_completed" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "athlete_watchlists" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"coach_user_id" varchar NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"monitor_public_profiles" boolean DEFAULT true NOT NULL,
	"monitor_stats" boolean DEFAULT true NOT NULL,
	"monitor_media" boolean DEFAULT true NOT NULL,
	"monitor_pr_progress" boolean DEFAULT true NOT NULL,
	"monitor_attendance" boolean DEFAULT true NOT NULL,
	"monitor_booking_inactivity" boolean DEFAULT false NOT NULL,
	"monitor_training_consistency" boolean DEFAULT true NOT NULL,
	"frequency" varchar DEFAULT 'weekly' NOT NULL,
	"last_checked_at" timestamp,
	"next_check_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "athletic_bookings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"date" varchar NOT NULL,
	"time_slot" varchar NOT NULL,
	"team_name" varchar NOT NULL,
	"training_type" varchar DEFAULT 'strength' NOT NULL,
	"booked_by" varchar,
	"org_user_id" varchar,
	"booker_email" varchar,
	"recurrence_id" varchar,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "athletic_hour_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"label" varchar NOT NULL,
	"start_date" varchar NOT NULL,
	"end_date" varchar NOT NULL,
	"start_hour" integer NOT NULL,
	"end_hour" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "athletic_programs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"slug" varchar NOT NULL,
	"type" varchar DEFAULT 'scheduling' NOT NULL,
	"max_teams_per_slot" integer DEFAULT 2 NOT NULL,
	"training_types" text[] DEFAULT '{"Strength","Speed"}'::text[],
	"start_hour" integer DEFAULT 16 NOT NULL,
	"end_hour" integer DEFAULT 20 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "attendance_email_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"athlete_email" varchar NOT NULL,
	"email_type" varchar NOT NULL,
	"subject" varchar,
	"status" varchar DEFAULT 'sent' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "attendance_program_fields" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"field_name" varchar NOT NULL,
	"label" varchar NOT NULL,
	"field_type" varchar DEFAULT 'text' NOT NULL,
	"visibility" varchar DEFAULT 'required' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "attendance_programs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"description" text,
	"location" varchar,
	"start_date" varchar,
	"end_date" varchar,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "attendance_programs_program_id_unique" UNIQUE("program_id")
);

CREATE TABLE "attendance_qr_codes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"public_slug" varchar NOT NULL,
	"qr_code_url" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "attendance_qr_codes_program_id_unique" UNIQUE("program_id"),
	CONSTRAINT "attendance_qr_codes_public_slug_unique" UNIQUE("public_slug")
);

CREATE TABLE "attendance_records" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"athlete_email" varchar NOT NULL,
	"athlete_first_name" varchar,
	"athlete_last_name" varchar,
	"phone" varchar,
	"sport" varchar,
	"position" varchar,
	"school" varchar,
	"grad_year" varchar,
	"team" varchar,
	"age" varchar,
	"extra_fields" jsonb DEFAULT '{}'::jsonb,
	"visit_number" integer DEFAULT 1 NOT NULL,
	"lead_id" varchar,
	"ip_address" varchar,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "attendance_reward_tiers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"visit_count" integer NOT NULL,
	"reward_name" varchar NOT NULL,
	"reward_description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "attendance_rewards_earned" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"tier_id" varchar NOT NULL,
	"athlete_email" varchar NOT NULL,
	"visit_count_at_earned" integer NOT NULL,
	"notification_sent_at" timestamp,
	"redeemed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "attention_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"level" varchar DEFAULT 'informational' NOT NULL,
	"category" varchar DEFAULT 'insight' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"source" varchar DEFAULT 'manual' NOT NULL,
	"source_id" varchar,
	"severity" integer DEFAULT 50 NOT NULL,
	"urgency" integer DEFAULT 50 NOT NULL,
	"business_impact" integer DEFAULT 50 NOT NULL,
	"confidence" double precision DEFAULT 0.8 NOT NULL,
	"action_url" text,
	"action_label" varchar,
	"status" varchar DEFAULT 'active' NOT NULL,
	"snoozed_until" timestamp,
	"escalated_at" timestamp,
	"expires_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "availability_blocks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" varchar NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"effective_from" timestamp,
	"effective_to" timestamp,
	"timezone" varchar DEFAULT 'America/New_York',
	"location" text DEFAULT ''
);

CREATE TABLE "beta_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"participant_id" text,
	"category" text NOT NULL,
	"rating" integer,
	"feedback" text NOT NULL,
	"agent_id" text,
	"feature_area" text,
	"resolved" boolean DEFAULT false,
	"resolution" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "beta_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"organization" text,
	"industry" text,
	"role" text NOT NULL,
	"invite_status" text DEFAULT 'pending',
	"activation_status" text DEFAULT 'not_activated',
	"invited_at" timestamp DEFAULT now(),
	"accepted_at" timestamp,
	"feedback_score" double precision,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "beta_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"org_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"organization" text,
	"industry" text,
	"status" text DEFAULT 'active',
	"joined_at" timestamp DEFAULT now(),
	"agents_installed" integer DEFAULT 0,
	"reviews_submitted" integer DEFAULT 0,
	"feedback_score" double precision,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "beta_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active',
	"start_date" timestamp DEFAULT now(),
	"end_date" timestamp,
	"target_coaches" integer DEFAULT 10,
	"target_gym_owners" integer DEFAULT 10,
	"target_facilities" integer DEFAULT 10,
	"target_consultants" integer DEFAULT 5,
	"target_developers" integer DEFAULT 5,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "blocked_times" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"reason" text DEFAULT '',
	"is_all_day" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "booking_participants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"participant_name" varchar,
	"joined_at" timestamp DEFAULT now()
);

CREATE TABLE "bookings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar,
	"client_id" varchar NOT NULL,
	"coach_id" varchar NOT NULL,
	"service_id" varchar NOT NULL,
	"location_id" varchar,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"status" "booking_status" DEFAULT 'CONFIRMED' NOT NULL,
	"notes" text DEFAULT '',
	"location" text DEFAULT '',
	"max_participants" integer,
	"group_description" text DEFAULT '',
	"age_range" text DEFAULT '',
	"skill_level" text DEFAULT '',
	"sport" text DEFAULT '',
	"recurring_group_id" varchar,
	"payment_method" "payment_method",
	"team_quote_program_id" varchar,
	"subscription_plan_id" varchar,
	"client_reminder_sent_at" timestamp,
	"coach_reminder_sent_at" timestamp,
	"google_calendar_event_id" varchar,
	"source_outcome_id" varchar,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "campaigns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"client_id" varchar NOT NULL,
	"client_name" varchar,
	"coach_id" varchar,
	"campaign_type" varchar NOT NULL,
	"status" "campaign_status" DEFAULT 'active',
	"current_step" integer DEFAULT 1,
	"total_steps" integer NOT NULL,
	"next_action_at" timestamp,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"stopped_reason" text,
	"revenue_attributed_cents" integer,
	"related_slot" jsonb,
	"metadata" jsonb
);

CREATE TABLE "cashouts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" varchar NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "cashout_status" DEFAULT 'REQUESTED' NOT NULL,
	"requested_at" timestamp DEFAULT now(),
	"processed_at" timestamp
);

CREATE TABLE "ceo_heartbeat_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"triggered_by" text DEFAULT 'cron' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"agents_coordinated" integer DEFAULT 0,
	"actions_evaluated" integer DEFAULT 0,
	"actions_auto_executed" integer DEFAULT 0,
	"actions_pending_approval" integer DEFAULT 0,
	"priorities_generated" integer DEFAULT 0,
	"errors_encountered" integer DEFAULT 0,
	"duration_ms" integer,
	"summary_json" jsonb,
	"error_message" text,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);

CREATE TABLE "closeout_audit_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"closeout_id" varchar NOT NULL,
	"actor" varchar NOT NULL,
	"action" varchar NOT NULL,
	"previous_status" varchar,
	"new_status" varchar,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "coach_daily_briefings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"generated_at" timestamp DEFAULT now(),
	"briefing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_by" varchar DEFAULT 'gpt-4o' NOT NULL,
	"summary" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "coach_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"coach_email" varchar,
	"password_hash" text,
	"bio" text DEFAULT '',
	"specialties" text[] DEFAULT '{}'::text[],
	"photo_url" text,
	"timezone" varchar DEFAULT 'America/New_York',
	"location" text DEFAULT '',
	"is_active" boolean DEFAULT true,
	"payout_percentage" integer,
	"organization_id" varchar,
	CONSTRAINT "coach_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "coach_profiles_coach_email_unique" UNIQUE("coach_email")
);

CREATE TABLE "communication_campaigns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"type" varchar DEFAULT 'manual' NOT NULL,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"created_by" varchar NOT NULL,
	"audience_filter" jsonb DEFAULT '{}'::jsonb,
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "communication_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"user_id" varchar,
	"coach_id" varchar,
	"booking_id" varchar,
	"agent_action_id" varchar,
	"type" varchar NOT NULL,
	"channel" varchar DEFAULT 'email' NOT NULL,
	"recipient_email" varchar,
	"recipient_phone" varchar,
	"subject" text,
	"message_body" text,
	"status" varchar DEFAULT 'sent' NOT NULL,
	"provider" varchar DEFAULT 'sendgrid' NOT NULL,
	"sent_at" timestamp DEFAULT now(),
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "communication_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" varchar,
	"org_id" varchar NOT NULL,
	"recipient_user_id" varchar,
	"recipient_type" varchar DEFAULT 'athlete' NOT NULL,
	"channel" varchar DEFAULT 'in_app' NOT NULL,
	"message_type" varchar DEFAULT 'reminder' NOT NULL,
	"subject" varchar,
	"body" text NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"read_at" timestamp,
	"sent_by" varchar,
	"ai_generated" boolean DEFAULT false,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "communication_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"guardian_enabled" boolean DEFAULT false NOT NULL,
	"quiet_hours_start" integer,
	"quiet_hours_end" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "communication_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar,
	"template_type" varchar NOT NULL,
	"title" varchar NOT NULL,
	"subject" varchar,
	"body" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "connector_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"connector" varchar NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"token_expiry" timestamp,
	"scope" text,
	"email" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "credit_ledger_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"booking_id" varchar,
	"subscription_id" varchar,
	"organization_id" varchar,
	"event_type" "credit_event_type" NOT NULL,
	"delta_sessions" integer DEFAULT 0 NOT NULL,
	"delta_cents" integer DEFAULT 0 NOT NULL,
	"sessions_after" integer,
	"reason" text DEFAULT '',
	"created_by" varchar,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "cross_org_learning_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text,
	"event_type" text NOT NULL,
	"outcome" text,
	"score" double precision DEFAULT 0,
	"industry" text,
	"benchmark_data" jsonb,
	"pattern_tags" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "deal_activities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"activity_type" "deal_activity_type" NOT NULL,
	"description" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "deal_revenue_attributions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"deal_id" varchar NOT NULL,
	"prospect_id" varchar NOT NULL,
	"won_at" timestamp DEFAULT now() NOT NULL,
	"final_value" integer DEFAULT 0,
	"days_to_close" integer DEFAULT 0,
	"total_touchpoints" integer DEFAULT 0,
	"primary_channel" varchar,
	"primary_strategy" varchar,
	"primary_tone" varchar,
	"attributed_outreach_ids" jsonb DEFAULT '[]'::jsonb,
	"outreach_sequence" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "deal_revenue_attributions_deal_id_unique" UNIQUE("deal_id")
);

CREATE TABLE "developer_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"org_id" text,
	"display_name" text NOT NULL,
	"email" text,
	"bio" text,
	"status" text DEFAULT 'active' NOT NULL,
	"total_installs" integer DEFAULT 0,
	"total_revenue" double precision DEFAULT 0,
	"lifetime_revenue" double precision DEFAULT 0,
	"agents_published" integer DEFAULT 0,
	"revenue_share_rate" double precision DEFAULT 0.3,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "developer_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"developer_id" text NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD',
	"period_start" timestamp,
	"period_end" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"breakdown" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "developer_royalty_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"developer_id" text NOT NULL,
	"balance" double precision DEFAULT 0,
	"lifetime_earned" double precision DEFAULT 0,
	"lifetime_paid" double precision DEFAULT 0,
	"pending_amount" double precision DEFAULT 0,
	"next_payout_date" timestamp,
	"payout_frequency" text DEFAULT 'monthly',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "developer_royalty_accounts_developer_id_unique" UNIQUE("developer_id")
);

CREATE TABLE "education_ai_generations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"pathway_id" varchar,
	"module_id" varchar,
	"coach_user_id" varchar NOT NULL,
	"generation_type" varchar NOT NULL,
	"prompt" text NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "education_ai_recommendations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"pathway_id" varchar NOT NULL,
	"reasoning" text NOT NULL,
	"trigger_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" varchar,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "education_assignment_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"created_by_user_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"description" text,
	"weeks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_to_type" varchar DEFAULT 'all_athletes' NOT NULL,
	"athlete_user_id" varchar,
	"team_id" varchar,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"start_date" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "education_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"pathway_id" varchar NOT NULL,
	"assigned_to_type" varchar NOT NULL,
	"athlete_user_id" varchar,
	"team_id" varchar,
	"assigned_by_user_id" varchar NOT NULL,
	"due_date" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "education_athlete_badges" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"badge_id" varchar NOT NULL,
	"pathway_id" varchar,
	"earned_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE "education_badges" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar,
	"pathway_id" varchar,
	"name" varchar NOT NULL,
	"description" text,
	"icon" varchar DEFAULT 'trophy' NOT NULL,
	"color" varchar DEFAULT 'amber' NOT NULL,
	"criteria" varchar DEFAULT 'pathway_completed' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "education_modules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar,
	"pathway_id" varchar NOT NULL,
	"module_number" integer NOT NULL,
	"title" varchar NOT NULL,
	"description" text,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"key_takeaways" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_minutes" integer DEFAULT 10,
	"video_url" varchar,
	"video_search_query" varchar,
	"performance_connection" text,
	"coach_reinforcement_notes" jsonb DEFAULT '[]'::jsonb,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "education_pathways" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar,
	"created_by_user_id" varchar,
	"title" varchar NOT NULL,
	"slug" varchar NOT NULL,
	"category" varchar DEFAULT 'custom' NOT NULL,
	"description" text,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "education_progress" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"pathway_id" varchar NOT NULL,
	"module_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"status" varchar DEFAULT 'not_started' NOT NULL,
	"quiz_score" integer,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "education_quiz_questions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar,
	"pathway_id" varchar NOT NULL,
	"module_id" varchar NOT NULL,
	"question" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correct_answer" integer NOT NULL,
	"explanation" text,
	"question_type" varchar DEFAULT 'module' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "education_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"created_by_user_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"trigger_type" varchar NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_type" varchar NOT NULL,
	"action_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "email_follow_ups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"outreach_draft_id" varchar NOT NULL,
	"prospect_id" varchar NOT NULL,
	"step_number" integer DEFAULT 1 NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"sent_at" timestamp,
	"status" "follow_up_status" DEFAULT 'pending',
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_retry_at" timestamp,
	"processing_started_at" timestamp,
	"last_error" text,
	"failed_at" timestamp,
	"subject" text,
	"body" text,
	"message_variant_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "email_message_variants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"subject_template" text NOT NULL,
	"body_template" text NOT NULL,
	"performance_score" integer DEFAULT 50,
	"times_used" integer DEFAULT 0,
	"replies" integer DEFAULT 0,
	"conversions" integer DEFAULT 0,
	"weight" integer DEFAULT 34,
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "email_trigger_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"prospect_id" varchar,
	"prospect_name" varchar,
	"outreach_draft_id" varchar,
	"follow_up_id" varchar,
	"trigger_type" "email_trigger_type" NOT NULL,
	"trigger_source" "email_trigger_source" NOT NULL,
	"action_type" "email_trigger_action_type" NOT NULL,
	"was_executed" boolean DEFAULT false,
	"execution_blocked" boolean DEFAULT false,
	"block_reason" "email_trigger_block_reason",
	"reasoning" text,
	"confidence_level" varchar,
	"risk_score" integer,
	"priority_score" integer,
	"missed_opportunity" boolean DEFAULT false,
	"collision_detected" boolean DEFAULT false,
	"collision_details" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "employment_applicants" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role_applied_for" text,
	"experience_level" text,
	"certifications" text,
	"location" text,
	"source" text,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"resume_url" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "executive_briefs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"biggest_opportunity" jsonb DEFAULT '{}'::jsonb,
	"highest_churn_risk" jsonb DEFAULT '{}'::jsonb,
	"scheduling_inefficiency" jsonb DEFAULT '{}'::jsonb,
	"most_valuable_lead" jsonb DEFAULT '{}'::jsonb,
	"projected_weekly_revenue" integer DEFAULT 0,
	"health_score" integer DEFAULT 50,
	"recommended_actions" jsonb DEFAULT '[]'::jsonb,
	"agent_summary" jsonb DEFAULT '{}'::jsonb,
	"raw_signals" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "exercise_effectiveness_scores" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"exercise_name" varchar NOT NULL,
	"exercise_id" varchar,
	"times_used" integer DEFAULT 0,
	"times_completed" integer DEFAULT 0,
	"completion_rate" integer DEFAULT 0,
	"progression_rate" integer DEFAULT 0,
	"pr_rate" integer DEFAULT 0,
	"soreness_rate" integer DEFAULT 0,
	"pain_rate" integer DEFAULT 0,
	"effectiveness_score" integer DEFAULT 50,
	"last_calculated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "exercise_library" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar,
	"name" varchar(200) NOT NULL,
	"slug" varchar(200) NOT NULL,
	"category" varchar(100) DEFAULT 'strength' NOT NULL,
	"movement_pattern" varchar(100),
	"primary_muscles" jsonb DEFAULT '[]'::jsonb,
	"secondary_muscles" jsonb DEFAULT '[]'::jsonb,
	"equipment" jsonb DEFAULT '[]'::jsonb,
	"difficulty" varchar(50) DEFAULT 'intermediate',
	"description" text,
	"coaching_cues" jsonb DEFAULT '[]'::jsonb,
	"common_mistakes" jsonb DEFAULT '[]'::jsonb,
	"progressions" jsonb DEFAULT '[]'::jsonb,
	"regressions" jsonb DEFAULT '[]'::jsonb,
	"youtube_url" varchar(500),
	"embedded_video_url" varchar(500),
	"video_url" varchar(500),
	"gif_url" varchar(500),
	"thumbnail_url" varchar(500),
	"coach_voiceover_url" varchar(500),
	"demo_type" varchar(30) DEFAULT 'youtube',
	"tags" jsonb DEFAULT '[]'::jsonb,
	"is_global" boolean DEFAULT false NOT NULL,
	"created_by_user_id" varchar,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "external_integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"integration_type" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"display_name" text,
	"auth_type" text DEFAULT 'api_key' NOT NULL,
	"encrypted_credentials" jsonb DEFAULT '{}'::jsonb,
	"scopes" jsonb DEFAULT '[]'::jsonb,
	"last_health_check_at" timestamp,
	"last_successful_action_at" timestamp,
	"last_failure_at" timestamp,
	"last_failure_reason" text,
	"rate_limit_state" jsonb DEFAULT '{}'::jsonb,
	"usage_stats" jsonb DEFAULT '{}'::jsonb,
	"governance_restrictions" jsonb DEFAULT '{}'::jsonb,
	"enabled_agents" jsonb DEFAULT '[]'::jsonb,
	"enabled_tools" jsonb DEFAULT '[]'::jsonb,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "financial_closeouts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"period_type" "closeout_period_type" DEFAULT 'monthly' NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"status" "closeout_status" DEFAULT 'draft' NOT NULL,
	"closed_by" varchar,
	"closed_at" timestamp,
	"reopened_by" varchar,
	"reopened_at" timestamp,
	"reopen_reason" text,
	"notes" text,
	"totals_snapshot" jsonb,
	"unresolved_issue_count" integer DEFAULT 0 NOT NULL,
	"acknowledged_warnings" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "financial_event_failures" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar,
	"client_id" varchar,
	"coach_id" varchar,
	"booking_id" varchar,
	"redemption_id" varchar,
	"source_type" varchar NOT NULL,
	"event_type" varchar NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" varchar,
	"failure_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"status" "financial_event_failure_status" DEFAULT 'pending' NOT NULL,
	"last_attempt_at" timestamp,
	"resolved_at" timestamp,
	"resolved_by" varchar,
	"ignore_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "gmail_agent_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"action_type" text NOT NULL,
	"gmail_thread_id" text,
	"gmail_message_id" text,
	"lead_id" text,
	"deal_id" text,
	"recipient_email" text,
	"subject" text,
	"body_preview" text,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"approval_required" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"result" jsonb,
	"error_message" text,
	"created_by_agent" text,
	"approved_by" text,
	"created_at" timestamp DEFAULT now(),
	"executed_at" timestamp,
	"communication_domain" text DEFAULT 'athlete_lead'
);

CREATE TABLE "gmail_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lead_id" text,
	"deal_id" text,
	"client_id" text,
	"gmail_thread_id" text NOT NULL,
	"last_message_id" text,
	"subject" text,
	"participant_email" text,
	"participant_name" text,
	"status" text DEFAULT 'open' NOT NULL,
	"intent" text,
	"last_inbound_at" timestamp,
	"last_outbound_at" timestamp,
	"last_snippet" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "guardian_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"guardian_user_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"type" varchar NOT NULL,
	"title" varchar NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "in_app_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"user_id" text,
	"category" text NOT NULL,
	"severity" text DEFAULT 'medium',
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open',
	"resolution" text,
	"agent_id" text,
	"page_context" text,
	"reporter" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "industry_benchmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"industry" text NOT NULL,
	"metric_name" text NOT NULL,
	"metric_value" double precision DEFAULT 0,
	"sample_size" integer DEFAULT 0,
	"period" text DEFAULT '30d' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "integration_execution_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"integration_id" text,
	"integration_type" text NOT NULL,
	"action_type" text NOT NULL,
	"agent_type" text,
	"workflow_job_id" text,
	"workflow_run_id" text,
	"idempotency_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_summary" text,
	"result_summary" text,
	"error_message" text,
	"error_class" text,
	"provider_status_code" integer,
	"latency_ms" integer,
	"tokens_used" integer,
	"cost_cents" integer,
	"model_used" text,
	"governance_checked" boolean DEFAULT false,
	"governance_decision" text,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);

CREATE TABLE "intervention_outcomes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"adaptation_draft_id" varchar,
	"intervention_recommendation_id" varchar,
	"intervention_type" varchar NOT NULL,
	"approved_at" timestamp,
	"evaluation_date" timestamp,
	"evaluated_at" timestamp,
	"readiness_before" integer,
	"readiness_after" integer,
	"readiness_delta" integer,
	"compliance_before" integer,
	"compliance_after" integer,
	"compliance_delta" integer,
	"rpe_before" integer,
	"rpe_after" integer,
	"rpe_delta" integer,
	"missed_sessions_before" integer,
	"missed_sessions_after" integer,
	"risk_level_before" varchar,
	"risk_level_after" varchar,
	"before_snapshot" jsonb,
	"after_snapshot" jsonb,
	"coach_feedback" text,
	"ai_effectiveness_rating" integer,
	"outcome_status" varchar DEFAULT 'pending_evaluation' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "job_execution_locks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"job_name" text NOT NULL,
	"lock_key" text NOT NULL,
	"acquired_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL,
	"released_at" timestamp,
	"status" text DEFAULT 'acquired' NOT NULL,
	CONSTRAINT "job_execution_locks_lock_key_unique" UNIQUE("lock_key")
);

CREATE TABLE "kevin_capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"capability" text NOT NULL,
	"approval_mode" "kevin_approval_mode" DEFAULT 'observe' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "kevin_context_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_type" text NOT NULL,
	"workflow" text,
	"entity_type" text,
	"entity_id" text,
	"question" text,
	"response_summary" text,
	"confidence" double precision,
	"memories_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"status" "kevin_context_status" NOT NULL,
	"origin_trace_id" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "kevin_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "kevin_event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone
);

CREATE TABLE "kevin_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"signal_id" text,
	"context_request_id" text,
	"run_id" text,
	"entity_type" text,
	"entity_id" text,
	"outcome" "kevin_outcome_type" NOT NULL,
	"result_summary" text,
	"was_useful" boolean,
	"was_modified" boolean,
	"recurred" boolean,
	"recorded_by" text,
	"forward_status" text DEFAULT 'pending' NOT NULL,
	"forward_attempts" integer DEFAULT 0 NOT NULL,
	"last_forward_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"forwarded_at" timestamp with time zone
);

CREATE TABLE "kevin_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "kevin_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"external_signal_id" text,
	"org_id" text NOT NULL,
	"signal_type" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"title" text NOT NULL,
	"summary" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" double precision,
	"risk_class" "kevin_risk_class",
	"source" text,
	"status" "kevin_signal_status" DEFAULT 'pending' NOT NULL,
	"routed_to" text,
	"attention_item_id" text,
	"origin_trace_id" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"routed_at" timestamp with time zone,
	"actioned_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);

CREATE TABLE "lead_capture_abandoned" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"athlete_name" varchar NOT NULL,
	"email" varchar NOT NULL,
	"phone" varchar,
	"utm_source" varchar,
	"utm_medium" varchar,
	"utm_campaign" varchar,
	"utm_content" varchar,
	"utm_term" varchar,
	"completed_at" timestamp,
	"submission_id" varchar,
	"recovery_sequence_status" varchar DEFAULT 'pending',
	"followup_sent_at" timestamp,
	"followup_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "lead_capture_follow_ups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"submission_id" varchar,
	"abandoned_id" varchar,
	"sequence_step" varchar NOT NULL,
	"channel" varchar DEFAULT 'email' NOT NULL,
	"status" varchar DEFAULT 'sent' NOT NULL,
	"subject" varchar,
	"body" text,
	"sent_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "lead_capture_funnel_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"event_type" varchar NOT NULL,
	"session_id" varchar,
	"utm_source" varchar,
	"utm_medium" varchar,
	"utm_campaign" varchar,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "lead_capture_programs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"headline" text DEFAULT 'Train Like an Elite Athlete',
	"subheadline" text DEFAULT 'Apply now and take the first step toward your athletic potential.',
	"cta_text" varchar DEFAULT 'Apply Now',
	"hero_image_url" text,
	"benefits" jsonb DEFAULT '[]'::jsonb,
	"social_proof" jsonb DEFAULT '[]'::jsonb,
	"who_is_this_for" text DEFAULT '',
	"meta_pixel_id" varchar,
	"google_ads_conversion_id" varchar,
	"google_ads_conversion_label" varchar,
	"booking_url" text,
	"booking_type" varchar DEFAULT 'none',
	"estimated_athlete_value_cents" integer DEFAULT 0,
	"extended_config" jsonb DEFAULT '{}'::jsonb,
	"funnel_type" varchar DEFAULT 'athlete_application',
	"show_in_org_menu" boolean DEFAULT true NOT NULL,
	"nav_label" varchar(120),
	"nav_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "lead_capture_programs_program_id_unique" UNIQUE("program_id")
);

CREATE TABLE "lead_capture_submissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"athlete_name" varchar NOT NULL,
	"parent_name" varchar,
	"parent_email" varchar,
	"email" varchar NOT NULL,
	"phone" varchar,
	"age" varchar,
	"grade" varchar,
	"sport" varchar,
	"position" varchar,
	"school" varchar,
	"goals" text[] DEFAULT '{}'::text[],
	"experience_level" varchar,
	"current_training_status" varchar,
	"commitment_level" varchar,
	"notes" text,
	"ai_qualification_score" integer,
	"ai_qualification_reason" text,
	"utm_source" varchar,
	"utm_medium" varchar,
	"utm_campaign" varchar,
	"utm_content" varchar,
	"utm_term" varchar,
	"abandoned_id" varchar,
	"contacted_at" timestamp,
	"last_follow_up_at" timestamp,
	"follow_up_count" integer DEFAULT 0,
	"sequence_status" varchar DEFAULT 'pending',
	"ai_next_action" text,
	"booking_status" varchar DEFAULT 'not_booked',
	"booked_at" timestamp,
	"evaluation_booked_at" timestamp,
	"attended_at" timestamp,
	"converted_at" timestamp,
	"lost_at" timestamp,
	"estimated_value_cents" integer DEFAULT 0,
	"ai_sales_analysis" jsonb,
	"admin_email_sent_at" timestamp,
	"admin_email_status" varchar,
	"admin_email_error" text,
	"applicant_email_sent_at" timestamp,
	"applicant_email_status" varchar,
	"applicant_email_error" text,
	"linked_user_id" varchar,
	"signup_converted_at" timestamp,
	"booking_converted_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "lead_intelligence_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"submission_id" varchar NOT NULL,
	"pipeline_stage" varchar DEFAULT 'new_lead' NOT NULL,
	"ai_summary" text,
	"normalized_profile_json" jsonb,
	"lead_score" integer,
	"temperature" varchar,
	"urgency" varchar,
	"suggested_next_action" varchar,
	"suggested_next_action_reason" text,
	"campaign_source" varchar,
	"campaign_medium" varchar,
	"campaign_name" varchar,
	"landing_page_id" varchar,
	"program_id" varchar,
	"tags" text[] DEFAULT '{}'::text[],
	"gmail_draft_action_id" varchar,
	"initial_draft_subject" text,
	"initial_draft_body" text,
	"follow_up_stage" varchar DEFAULT 'none',
	"last_interaction_at" timestamp,
	"next_follow_up_at" timestamp,
	"unsubscribed" boolean DEFAULT false NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	"suppression_reason" text,
	"suppressed_at" timestamp,
	"stage_transitions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"intake_processed_at" timestamp,
	"scoring_processed_at" timestamp,
	"draft_generated_at" timestamp,
	"processing_log" jsonb DEFAULT '[]'::jsonb,
	"processing_duration_ms" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "lead_intelligence_profiles_submission_id_unique" UNIQUE("submission_id")
);

CREATE TABLE "lead_scheduling_contexts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"lead_id" varchar NOT NULL,
	"submission_id" varchar NOT NULL,
	"gmail_thread_id" varchar,
	"offered_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_slot" jsonb,
	"status" varchar DEFAULT 'none' NOT NULL,
	"expires_at" timestamp,
	"athletic_booking_id" varchar,
	"last_reply_message_id" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "lead_scheduling_contexts_submission_id_unique" UNIQUE("submission_id")
);

CREATE TABLE "locations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"description" text DEFAULT '',
	"address" text DEFAULT '',
	"capacity" integer,
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "notification_automation_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"user_id" varchar,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notification_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar DEFAULT 'processed' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "nutrition_modules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar,
	"module_number" integer NOT NULL,
	"title" varchar NOT NULL,
	"description" text,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "nutrition_progress" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"module_id" varchar NOT NULL,
	"status" varchar DEFAULT 'not_started' NOT NULL,
	"quiz_score" integer,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "nutrition_quiz_attempts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"module_id" varchar NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" integer NOT NULL,
	"passed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "nutrition_quiz_questions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" varchar NOT NULL,
	"question" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correct_answer" integer NOT NULL,
	"explanation" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "operator_action_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_action_id" varchar NOT NULL,
	"actor_id" varchar,
	"event_type" varchar NOT NULL,
	"previous_status" varchar,
	"new_status" varchar,
	"note" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "operator_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"source_type" varchar DEFAULT 'manual' NOT NULL,
	"source_key" varchar,
	"severity" varchar DEFAULT 'info' NOT NULL,
	"category" varchar DEFAULT 'financial' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"suggested_action" text,
	"status" varchar DEFAULT 'open' NOT NULL,
	"assigned_to_user_id" varchar,
	"assigned_to_coach_id" varchar,
	"related_client_id" varchar,
	"related_booking_id" varchar,
	"related_coach_id" varchar,
	"related_closeout_id" varchar,
	"estimated_impact" text,
	"metadata" jsonb,
	"acknowledged_at" timestamp,
	"resolved_at" timestamp,
	"ignored_at" timestamp,
	"ignored_reason" text,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "orchestrator_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"triggered_by" varchar DEFAULT 'manual' NOT NULL,
	"agents_run" text[] DEFAULT '{}',
	"signals_created" integer DEFAULT 0,
	"recommendations_created" integer DEFAULT 0,
	"status" varchar DEFAULT 'running' NOT NULL,
	"completed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "org_activity_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"user_id" varchar,
	"team_id" varchar,
	"source_type" varchar NOT NULL,
	"source_id" varchar,
	"event_type" varchar NOT NULL,
	"title" varchar NOT NULL,
	"description" text,
	"event_date" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" varchar DEFAULT 'athlete' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "org_ai_approval_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_id" text,
	"risk_level" text NOT NULL,
	"action_type" text,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"approval_threshold" double precision DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "org_ai_execution_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_id" text,
	"recommendation_id" text,
	"title" text NOT NULL,
	"execution_type" text NOT NULL,
	"execution_status" text DEFAULT 'draft' NOT NULL,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"estimated_value" double precision DEFAULT 0,
	"actual_value" double precision,
	"execution_steps" jsonb,
	"audit_trail" jsonb,
	"notes" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "org_ai_experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"agent_id" text,
	"workflow_id" text,
	"experiment_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"variant_a" jsonb,
	"variant_b" jsonb,
	"variant_a_metrics" jsonb,
	"variant_b_metrics" jsonb,
	"winner" text,
	"confidence" double precision DEFAULT 0,
	"learning_events" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "org_ai_governance_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"default_autonomy_mode" text DEFAULT 'supervised' NOT NULL,
	"maximum_allowed_risk_level" text DEFAULT 'medium' NOT NULL,
	"default_confidence_threshold" double precision DEFAULT 0.75,
	"operator_review_required" boolean DEFAULT true,
	"allow_autonomous_communication" boolean DEFAULT false,
	"allow_autonomous_scheduling" boolean DEFAULT false,
	"allow_autonomous_financial_actions" boolean DEFAULT false,
	"allow_research_agents" boolean DEFAULT true,
	"allow_external_web_access" boolean DEFAULT false,
	"allow_cross_workflow_memory" boolean DEFAULT true,
	"ai_activity_visibility_mode" text DEFAULT 'full',
	"strict_mode_enabled" boolean DEFAULT false,
	"emergency_pause_enabled" boolean DEFAULT false,
	"emergency_pause_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "org_ai_governance_settings_org_id_unique" UNIQUE("org_id")
);

CREATE TABLE "org_ai_integrations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"provider" varchar NOT NULL,
	"api_key_encrypted" text,
	"api_base_url" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_tested_at" timestamp,
	"last_success_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "org_ai_learning_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_id" text,
	"workflow_id" text,
	"event_type" text NOT NULL,
	"outcome" text,
	"score" double precision DEFAULT 0,
	"context" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "org_ai_opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"potential_value" double precision DEFAULT 0,
	"confidence" double precision DEFAULT 0.8,
	"status" text DEFAULT 'open' NOT NULL,
	"source_data" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "org_ai_workforce_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_type" text NOT NULL,
	"changed_by" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "org_ai_workforce_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"memory_type" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"outcome" text,
	"value" double precision DEFAULT 0,
	"context" jsonb,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp
);

CREATE TABLE "org_ai_workforce_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"outcome_type" text NOT NULL,
	"outcome_category" text NOT NULL,
	"value" double precision DEFAULT 0,
	"currency_value" double precision DEFAULT 0,
	"source_record_id" text,
	"source_table" text,
	"confidence_score" double precision DEFAULT 0.8,
	"attributed_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "org_ai_workforce_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb,
	"org_preset" text,
	"enabled_departments" jsonb DEFAULT '[]'::jsonb,
	"governance_mode" text DEFAULT 'collaborative' NOT NULL,
	"selected_integrations" jsonb DEFAULT '[]'::jsonb,
	"selected_workflow_templates" jsonb DEFAULT '[]'::jsonb,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"onboarding_completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "org_ai_workforce_settings_org_id_unique" UNIQUE("org_id")
);

CREATE TABLE "org_automation_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"auto_send_first_response" boolean DEFAULT false NOT NULL,
	"auto_send_low_risk_follow_ups" boolean DEFAULT false NOT NULL,
	"auto_send_booking_confirmation" boolean DEFAULT false NOT NULL,
	"auto_offer_scheduling_slots" boolean DEFAULT false NOT NULL,
	"auto_book_confirmed_slots" boolean DEFAULT false NOT NULL,
	"min_auto_send_confidence" double precision DEFAULT 0.85 NOT NULL,
	"min_auto_booking_confidence" double precision DEFAULT 0.9 NOT NULL,
	"daily_email_cap" integer DEFAULT 20 NOT NULL,
	"daily_booking_cap" integer DEFAULT 10 NOT NULL,
	"allowed_send_window_start" text DEFAULT '08:00' NOT NULL,
	"allowed_send_window_end" text DEFAULT '20:00' NOT NULL,
	"require_approval_for_first_contact" boolean DEFAULT true NOT NULL,
	"require_approval_for_new_recipients" boolean DEFAULT true NOT NULL,
	"notify_coach_on_auto_action" boolean DEFAULT true NOT NULL,
	"policy_version" text DEFAULT '1.0.0' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "org_automation_settings_org_id_unique" UNIQUE("org_id")
);

CREATE TABLE "org_email_notification_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_booking_confirmation" boolean DEFAULT true NOT NULL,
	"athlete_recurring_confirmation" boolean DEFAULT true NOT NULL,
	"athlete_reschedule" boolean DEFAULT true NOT NULL,
	"athlete_cancellation" boolean DEFAULT true NOT NULL,
	"athlete_reminder" boolean DEFAULT true NOT NULL,
	"admin_new_booking" boolean DEFAULT true NOT NULL,
	"admin_recurring_booking" boolean DEFAULT false NOT NULL,
	"admin_reschedule" boolean DEFAULT true NOT NULL,
	"admin_cancellation" boolean DEFAULT true NOT NULL,
	"dedup_window_minutes" integer DEFAULT 15 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "org_email_notification_settings_org_id_unique" UNIQUE("org_id")
);

CREATE TABLE "org_execution_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"category" text NOT NULL,
	"limit_window" text DEFAULT 'hour' NOT NULL,
	"max_executions" integer DEFAULT 50 NOT NULL,
	"current_count" integer DEFAULT 0,
	"reset_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "org_installed_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_template_id" text,
	"agent_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"configuration" jsonb,
	"governance_policy" jsonb,
	"performance_metrics" jsonb,
	"installed_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "org_memberships" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" varchar DEFAULT 'athlete' NOT NULL,
	"status" varchar DEFAULT 'active' NOT NULL,
	"permissions" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "org_message_reads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"message_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "org_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"sender_user_id" varchar NOT NULL,
	"recipient_user_id" varchar,
	"team_id" varchar,
	"message_type" varchar DEFAULT 'direct' NOT NULL,
	"subject" varchar,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "org_notification_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"booking_reminders" boolean DEFAULT true NOT NULL,
	"pr_updates" boolean DEFAULT true NOT NULL,
	"team_announcements" boolean DEFAULT true NOT NULL,
	"marketing_emails" boolean DEFAULT false NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "org_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"type" varchar NOT NULL,
	"title" varchar NOT NULL,
	"message" text NOT NULL,
	"action_url" varchar,
	"metadata" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "org_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"token_hash" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"keep_logged_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"last_used_at" timestamp DEFAULT now()
);

CREATE TABLE "org_users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"email" varchar NOT NULL,
	"password_hash" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"last_login_at" timestamp
);

CREATE TABLE "organization_event_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"source_system" text NOT NULL,
	"athlete_user_id" text,
	"coach_user_id" text,
	"payload" jsonb,
	"triggered_workflows" jsonb,
	"resulting_actions" jsonb,
	"resolution_state" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp,
	"escalation_level" integer DEFAULT 0,
	"correlation_id" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "organization_event_log_event_id_unique" UNIQUE("event_id")
);

CREATE TABLE "organization_intelligence_state" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"overall_health_score" integer DEFAULT 100,
	"intervention_load" integer DEFAULT 0,
	"critical_athlete_count" integer DEFAULT 0,
	"unresolved_critical_athletes" jsonb,
	"coach_workload_score" integer DEFAULT 0,
	"compliance_health_score" integer DEFAULT 100,
	"engagement_trend_direction" text DEFAULT 'stable',
	"fatigue_risk_level" text DEFAULT 'low',
	"recovery_trend_direction" text DEFAULT 'stable',
	"readiness_distribution" jsonb,
	"predicted_churn_risks" integer DEFAULT 0,
	"unresolved_interventions" integer DEFAULT 0,
	"last_daily_ops_at" timestamp,
	"last_updated_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "organization_intelligence_state_org_id_unique" UNIQUE("org_id")
);

CREATE TABLE "organization_media" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"media_type" "media_type" DEFAULT 'image' NOT NULL,
	"section" "media_section" DEFAULT 'hero' NOT NULL,
	"url" text NOT NULL,
	"thumbnail_url" text,
	"caption" text,
	"alt_text" text,
	"order_index" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"focal_point" varchar DEFAULT 'center',
	"uploaded_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "organization_subscription_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"stripe_product_id" varchar NOT NULL,
	"stripe_price_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"description" text DEFAULT '',
	"amount_cents" integer NOT NULL,
	"interval" varchar NOT NULL,
	"interval_count" integer DEFAULT 1,
	"cancellation_policy" varchar DEFAULT 'end_of_period',
	"coach_pay_per_session_cents" integer,
	"sessions_per_week" integer DEFAULT 1,
	"session_type" varchar DEFAULT 'personal',
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "organizations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"slug" varchar NOT NULL,
	"logo_url" text,
	"organization_type" varchar DEFAULT 'performance_facility',
	"primary_sport" varchar DEFAULT '',
	"improvement_goals" text[] DEFAULT '{}'::text[],
	"onboarding_completed" boolean DEFAULT false,
	"owner_user_id" varchar,
	"owner_email" varchar,
	"tagline" text DEFAULT '',
	"tagline2" text DEFAULT '',
	"primary_color" varchar DEFAULT '',
	"secondary_color" varchar DEFAULT '',
	"email_primary_color" varchar DEFAULT '',
	"email_secondary_color" varchar DEFAULT '',
	"website_url" text,
	"instagram_url" text,
	"facebook_url" text,
	"youtube_url" text,
	"tiktok_url" text,
	"linktree_url" text,
	"stripe_secret_key" text,
	"stripe_publishable_key" text,
	"locations" text[] DEFAULT '{}'::text[],
	"stripe_customer_id" varchar,
	"stripe_subscription_id" varchar,
	"subscription_status" "subscription_status" DEFAULT 'none',
	"trial_ends_at" timestamp,
	"subscription_current_period_end" timestamp,
	"subscriptions_enabled" boolean DEFAULT false,
	"athletic_start_hour" integer,
	"athletic_end_hour" integer,
	"coach_transactions_visible" boolean DEFAULT true,
	"athletic_enabled" boolean DEFAULT false,
	"athletic_program_name" varchar DEFAULT '',
	"automation_level" integer DEFAULT 1,
	"scheduling_inquiry_email" varchar,
	"scheduling_inquiry_name" varchar,
	"allow_user_inquiry_emails" boolean DEFAULT true,
	"timezone" varchar DEFAULT 'America/New_York',
	"social_preview_image_url" text,
	"allow_guest_booking" boolean DEFAULT true,
	"require_login_to_book" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);

CREATE TABLE "outreach_drafts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"workflow_id" varchar,
	"operator_action_id" varchar,
	"related_client_id" varchar,
	"related_coach_id" varchar,
	"channel" varchar DEFAULT 'email' NOT NULL,
	"purpose" varchar DEFAULT 'general' NOT NULL,
	"tone" varchar DEFAULT 'professional' NOT NULL,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"subject" varchar,
	"content" text DEFAULT '' NOT NULL,
	"ai_generated" boolean DEFAULT false,
	"ai_prompt_snapshot" text,
	"ai_context_snapshot" jsonb,
	"generated_by" varchar,
	"approved_by" varchar,
	"sent_by" varchar,
	"approved_at" timestamp,
	"sent_at" timestamp,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"send_result" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "outreach_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outreach_draft_id" varchar NOT NULL,
	"actor_id" varchar,
	"event_type" varchar NOT NULL,
	"previous_status" varchar,
	"new_status" varchar,
	"note" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "parent_guardians" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"org_user_id" varchar NOT NULL,
	"relationship_type" varchar DEFAULT 'guardian' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "pr_agent_research_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"coach_user_id" varchar NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"query" jsonb,
	"result" jsonb,
	"error_message" text,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);

CREATE TABLE "pr_import_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"coach_user_id" varchar NOT NULL,
	"filename" varchar,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"row_count" integer DEFAULT 0,
	"success_count" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"errors" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "pr_lift_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"team_id" varchar,
	"lift_type_id" varchar NOT NULL,
	"value" double precision NOT NULL,
	"unit" varchar DEFAULT 'lbs' NOT NULL,
	"entry_date" varchar NOT NULL,
	"notes" text,
	"verified_by_coach_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "pr_lift_types" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"category" varchar,
	"unit" varchar DEFAULT 'lbs' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "pr_team_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"team_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" varchar DEFAULT 'athlete' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "pr_teams" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"program_id" varchar NOT NULL,
	"coach_user_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"sport" varchar,
	"season" varchar,
	"join_code" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"archived_at" timestamp
);

CREATE TABLE "program_adaptation_drafts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"workout_program_id" varchar,
	"context_object_id" varchar NOT NULL,
	"trigger_signals" jsonb DEFAULT '[]'::jsonb,
	"adaptation_type" varchar NOT NULL,
	"previous_context_snapshot" jsonb,
	"new_context_snapshot" jsonb,
	"trainchat_program_id" varchar,
	"trainchat_raw_response" jsonb,
	"draft_sessions" jsonb DEFAULT '[]'::jsonb,
	"adaptation_rationale" text,
	"status" varchar DEFAULT 'pending_review' NOT NULL,
	"reviewed_by_user_id" varchar,
	"reviewed_at" timestamp,
	"coach_notes" text,
	"education_pathway_id" varchar,
	"generation_error" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "program_blocks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_program_id" varchar NOT NULL,
	"week_number" integer NOT NULL,
	"title" varchar(200),
	"description" text,
	"block_type" varchar(50) DEFAULT 'standard',
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "program_session_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_session_id" varchar NOT NULL,
	"group_type" varchar(50) DEFAULT 'superset' NOT NULL,
	"title" varchar(200),
	"exercise_indices" jsonb DEFAULT '[]'::jsonb,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "program_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar,
	"created_by_user_id" varchar,
	"title" varchar(200) NOT NULL,
	"description" text,
	"sport" varchar(100),
	"category" varchar(100),
	"visibility" varchar(20) DEFAULT 'private' NOT NULL,
	"template_data" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "prospect_opt_outs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"email" varchar NOT NULL,
	"opted_out_at" timestamp DEFAULT now(),
	"reason" text
);

CREATE TABLE "redemptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" varchar NOT NULL,
	"coach_id" varchar NOT NULL,
	"redeemed_at" timestamp DEFAULT now(),
	"payout_status" "payout_status" DEFAULT 'PENDING' NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "retention_agent_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"agent_job_id" text NOT NULL,
	"risk_level" "retention_risk_level" NOT NULL,
	"risk_score" integer NOT NULL,
	"confidence_score" integer NOT NULL,
	"summary" text NOT NULL,
	"risk_factors" jsonb,
	"recommended_actions" jsonb,
	"draft_message" text,
	"evidence" jsonb,
	"model_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "retention_workflow_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" varchar NOT NULL,
	"actor_id" varchar,
	"event_type" varchar NOT NULL,
	"note" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "retention_workflows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"workflow_type" varchar DEFAULT 'manual' NOT NULL,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"related_client_id" varchar,
	"related_operator_action_id" varchar,
	"risk_severity" varchar DEFAULT 'warning' NOT NULL,
	"estimated_revenue_at_risk_cents" integer DEFAULT 0,
	"estimated_recoverable_revenue_cents" integer DEFAULT 0,
	"metadata" jsonb,
	"created_by" varchar,
	"started_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "revenue_agent_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"deal_id" varchar,
	"prospect_id" varchar,
	"action_type" varchar NOT NULL,
	"reason" text NOT NULL,
	"estimated_value" integer DEFAULT 0,
	"confidence" integer DEFAULT 50,
	"priority" integer DEFAULT 50,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"accepted_at" timestamp,
	"dismissed_at" timestamp,
	"executed_at" timestamp,
	"outcome_type" varchar,
	"outcome_value" integer DEFAULT 0,
	"outcome_logged_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"agent_run_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "revenue_agent_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"triggered_by" varchar DEFAULT 'manual' NOT NULL,
	"actions_created" integer DEFAULT 0,
	"drafts_saved" integer DEFAULT 0,
	"follow_ups_scheduled" integer DEFAULT 0,
	"stale_labeled" integer DEFAULT 0,
	"status" varchar DEFAULT 'running' NOT NULL,
	"completed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "revenue_agent_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"auto_save_drafts" boolean DEFAULT false,
	"auto_schedule_follow_up" boolean DEFAULT false,
	"auto_label_stale" boolean DEFAULT false,
	"daily_run_enabled" boolean DEFAULT true,
	"daily_run_hour" integer DEFAULT 8,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "revenue_agent_settings_org_id_unique" UNIQUE("org_id")
);

CREATE TABLE "revenue_ledger_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar,
	"client_id" varchar,
	"coach_id" varchar,
	"booking_id" varchar,
	"redemption_id" varchar,
	"event_type" "revenue_ledger_event_type" NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"reason" text DEFAULT '',
	"source_action" varchar,
	"created_by" varchar,
	"idempotency_key" varchar,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "revenue_ledger_events_idempotency_key_unique" UNIQUE("idempotency_key")
);

CREATE TABLE "royalty_distributions" (
	"id" text PRIMARY KEY NOT NULL,
	"developer_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"revenue_source" text NOT NULL,
	"gross_revenue" double precision DEFAULT 0,
	"platform_share" double precision DEFAULT 0,
	"developer_share" double precision DEFAULT 0,
	"platform_share_rate" double precision DEFAULT 0.7,
	"developer_share_rate" double precision DEFAULT 0.3,
	"payout_status" text DEFAULT 'pending',
	"period" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "services" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"description" text DEFAULT '',
	"duration_min" integer DEFAULT 60 NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true,
	"session_type" "session_type" DEFAULT '1_ON_1',
	"stripe_product_id" varchar,
	"stripe_price_id" varchar,
	"organization_id" varchar,
	"category" "service_category" DEFAULT 'paid',
	"counts_toward_revenue" boolean DEFAULT true,
	"revenue_recognition" "revenue_recognition" DEFAULT 'at_booking',
	"payout_type" "payout_type" DEFAULT 'percentage',
	"payout_value_cents" integer,
	"payout_percent" integer,
	"coach_pay_when_redeemed" boolean DEFAULT false,
	"counts_toward_utilization" boolean DEFAULT true,
	"blocks_availability" boolean DEFAULT true,
	"counts_toward_session_count" boolean DEFAULT true,
	"requires_client" boolean DEFAULT true,
	"is_bookable_by_client" boolean DEFAULT true,
	"is_bookable_by_coach" boolean DEFAULT true
);

CREATE TABLE "software_improvement_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"source_agent" varchar NOT NULL,
	"source_type" varchar NOT NULL,
	"source_ref_id" varchar,
	"title" varchar(512) NOT NULL,
	"problem_summary" text NOT NULL,
	"business_context" text,
	"affected_area" varchar(256),
	"suspected_files" text,
	"reproduction_steps" text,
	"expected_behavior" text,
	"constraints" text,
	"acceptance_checks" text,
	"severity" varchar(32) DEFAULT 'medium' NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"status" "software_improvement_status" DEFAULT 'detected' NOT NULL,
	"codex_prompt" text,
	"codex_status" varchar(64),
	"codex_branch" varchar(256),
	"codex_pr_url" varchar(512),
	"github_issue_url" varchar(512),
	"github_approval_queue_id" varchar(256),
	"github_issue_draft" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);

CREATE TABLE "stripe_webhook_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" varchar NOT NULL,
	"event_type" varchar NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"processed_status" varchar DEFAULT 'pending' NOT NULL,
	"processing_error" text,
	"customer_id" varchar,
	"payment_intent_id" varchar,
	"subscription_id" varchar,
	"org_id" varchar,
	"user_id" varchar,
	"amount_cents" integer,
	"metadata" jsonb,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	CONSTRAINT "stripe_webhook_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);

CREATE TABLE "subscription_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"subscription_plan_id" varchar NOT NULL,
	"client_id" varchar NOT NULL,
	"coach_id" varchar NOT NULL,
	"service_id" varchar NOT NULL,
	"days_of_week" integer[] NOT NULL,
	"start_time" varchar NOT NULL,
	"location" varchar DEFAULT '',
	"notes" text DEFAULT '',
	"max_participants" integer,
	"group_description" text DEFAULT '',
	"age_range" varchar DEFAULT '',
	"skill_level" varchar DEFAULT '',
	"sport" varchar DEFAULT '',
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "team_quotes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_name" varchar NOT NULL,
	"number_of_athletes" integer NOT NULL,
	"cost_per_athlete_cents" integer NOT NULL,
	"training_type" "training_type_enum" NOT NULL,
	"frequency" varchar NOT NULL,
	"duration_weeks" integer NOT NULL,
	"coach_email" varchar NOT NULL,
	"total_cents" integer NOT NULL,
	"status" "quote_status" DEFAULT 'DRAFT' NOT NULL,
	"stripe_invoice_id" varchar,
	"stripe_invoice_url" varchar,
	"created_by_coach_id" varchar NOT NULL,
	"program_id" varchar DEFAULT gen_random_uuid(),
	"current_month" integer DEFAULT 1 NOT NULL,
	"total_months" integer DEFAULT 1 NOT NULL,
	"organization_id" varchar,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "team_training_deals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"prospect_id" varchar NOT NULL,
	"outreach_draft_id" varchar,
	"status" "deal_status" DEFAULT 'new' NOT NULL,
	"estimated_value" integer DEFAULT 0 NOT NULL,
	"final_value" integer,
	"probability" integer DEFAULT 40 NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"last_contact_at" timestamp,
	"next_follow_up_at" timestamp,
	"next_action" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "team_training_discovery_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"prospect_id" varchar,
	"prospect_name" varchar,
	"attempted_at" timestamp DEFAULT now(),
	"query" text,
	"source_url" text,
	"confidence" double precision,
	"result" varchar,
	"action" varchar,
	"notes" text
);

CREATE TABLE "team_training_lead_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"default_location" text DEFAULT '',
	"radius_miles" integer DEFAULT 25,
	"recurring_enabled" boolean DEFAULT false,
	"recurring_frequency" varchar DEFAULT 'weekly',
	"recurring_day_of_week" integer,
	"recurring_time" varchar DEFAULT '08:00',
	"recurring_limit" integer DEFAULT 8,
	"recurring_sport" varchar DEFAULT 'all',
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"last_search_category_index" integer DEFAULT 0,
	"last_search_location_index" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "team_training_outreach_drafts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"prospect_id" varchar NOT NULL,
	"deal_id" varchar,
	"channel" varchar DEFAULT 'email',
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"outreach_tone" varchar,
	"ai_strategy_tag" varchar,
	"cta_type" varchar,
	"response_received" boolean DEFAULT false,
	"meeting_booked" boolean DEFAULT false,
	"approved" boolean DEFAULT false,
	"approved_at" timestamp,
	"sent_at" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"replied_at" timestamp,
	"bounce_type" varchar,
	"message_variant_id" varchar,
	"reply_text" text,
	"reply_classification" "reply_classification",
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "team_training_outreach_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"prospect_id" varchar,
	"draft_id" varchar,
	"event_type" "team_outreach_event_type" NOT NULL,
	"description" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "team_training_prospects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"pipeline_type" varchar DEFAULT 'b2b',
	"lead_type" varchar DEFAULT 'team_partnership',
	"prospect_name" varchar NOT NULL,
	"organization_type" varchar DEFAULT 'unknown',
	"sport" varchar DEFAULT 'unknown',
	"city" varchar DEFAULT 'unknown',
	"state" varchar DEFAULT 'unknown',
	"website_url" text,
	"contact_name" varchar DEFAULT 'unknown',
	"contact_role" varchar DEFAULT 'unknown',
	"contact_email" varchar,
	"contact_phone" varchar,
	"source_url" text,
	"confidence_score" integer DEFAULT 50,
	"estimated_value" integer,
	"outreach_status" "prospect_outreach_status" DEFAULT 'New',
	"last_contacted_at" timestamp,
	"queued_for_today_at" timestamp,
	"notes" text DEFAULT '',
	"decision_maker_name" varchar,
	"decision_maker_title" varchar,
	"decision_maker_email" varchar,
	"contact_confidence" integer DEFAULT 0,
	"contact_source_url" text,
	"contact_quality" varchar DEFAULT 'missing',
	"contact_source_type" varchar DEFAULT 'unverified',
	"verification_status" varchar DEFAULT 'unverified',
	"enrichment_explanation" text,
	"alternative_contacts" text,
	"contact_source_title" text,
	"contact_source_snippet" text,
	"contact_discovered_at" timestamp,
	"contact_discovery_method" varchar,
	"contact_confidence_score" double precision,
	"last_discovery_attempt_at" timestamp,
	"last_discovery_result" varchar,
	"discovery_source_type" varchar,
	"discovery_source_url" text,
	"discovery_source_title" text,
	"discovery_source_snippet" text,
	"discovery_query" text,
	"discovery_method" varchar,
	"discovery_confidence_score" double precision,
	"discovered_at" timestamp,
	"last_validated_at" timestamp,
	"lead_validation_status" varchar DEFAULT 'likely_valid',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "unified_agent_action_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_name" text,
	"action_type" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"workflow_run_id" text,
	"tool_name" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"confidence_score" double precision,
	"risk_level" text DEFAULT 'low',
	"input_snapshot" jsonb,
	"output_snapshot" jsonb,
	"reasoning_summary" text,
	"error_message" text,
	"rollback_available" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "user_org_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"sms_opt_in" boolean DEFAULT false NOT NULL,
	"sms_opt_in_at" timestamp,
	"sms_opt_out_at" timestamp,
	"notification_preferences" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "user_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"role" "user_role" DEFAULT 'CLIENT' NOT NULL,
	"organization_id" varchar
);

CREATE TABLE "user_subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"plan_id" varchar NOT NULL,
	"stripe_subscription_id" varchar,
	"stripe_checkout_session_id" varchar,
	"status" varchar DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"sessions_remaining" integer,
	"cancel_at_period_end" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "waitlist" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"client_id" varchar NOT NULL,
	"coach_id" varchar,
	"session_type" varchar,
	"preferred_days" integer[],
	"preferred_time_start" varchar,
	"preferred_time_end" varchar,
	"notes" text DEFAULT '',
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "wallet_transactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"type" "wallet_tx_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text DEFAULT '',
	"source_type" varchar,
	"source_id" varchar,
	"stripe_session_id" varchar,
	"stripe_payment_intent_id" varchar,
	"stripe_charge_id" varchar,
	"currency" varchar DEFAULT 'usd',
	"payment_status" varchar,
	"livemode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "white_label_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source_agent_id" text NOT NULL,
	"custom_name" text NOT NULL,
	"custom_description" text,
	"custom_capabilities" jsonb,
	"custom_rules" jsonb,
	"branding" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"install_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "workflow_conflicts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"conflicting_workflow_id" text NOT NULL,
	"conflict_type" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb,
	"resolution" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "workflow_context" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"context_type" text NOT NULL,
	"summary" text NOT NULL,
	"structured_context" jsonb,
	"last_outcome" text,
	"last_confidence_score" double precision,
	"memory_importance_score" double precision DEFAULT 0.5,
	"source_workflow_id" text,
	"source_action_log_id" text,
	"created_by" text DEFAULT 'system' NOT NULL,
	"archived" boolean DEFAULT false,
	"compressed" boolean DEFAULT false,
	"never_delete" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "workflow_execution_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"org_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration_ms" integer,
	"trigger_type" text,
	"action_count" integer DEFAULT 0 NOT NULL,
	"approval_gates_hit" integer DEFAULT 0 NOT NULL,
	"blocked_reason" text,
	"lead_id" text,
	"booking_id" text,
	"deal_id" text,
	"gmail_action_id" text,
	"estimated_revenue_influenced" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "workflow_graph_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"graph_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot_definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compiled_definition" jsonb,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"change_notes" text,
	"published_by" text,
	"published_at" timestamp DEFAULT now(),
	"is_active" boolean DEFAULT false NOT NULL
);

CREATE TABLE "workflow_graphs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'custom' NOT NULL,
	"graph_version" integer DEFAULT 1 NOT NULL,
	"graph_definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compiled_definition" jsonb,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"estimated_complexity" integer DEFAULT 0,
	"estimated_execution_cost_cents" integer DEFAULT 0,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"governance_warnings" jsonb DEFAULT '[]'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"published" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"template_rating" integer,
	"source_template_id" text,
	"created_by" text,
	"last_compiled_at" timestamp,
	"last_simulated_at" timestamp,
	"last_published_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "workflow_job_effects" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workflow_job_id" text NOT NULL,
	"effect_key" text NOT NULL,
	"execution_generation" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'claimed' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"last_error" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "workflow_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workflow_run_id" text,
	"workflow_step_id" text,
	"job_type" text DEFAULT 'workflow_step' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"scheduled_for" timestamp DEFAULT now(),
	"started_at" timestamp,
	"completed_at" timestamp,
	"failed_at" timestamp,
	"attempts" integer DEFAULT 0,
	"max_attempts" integer DEFAULT 3,
	"next_retry_at" timestamp,
	"retry_backoff_ms" integer DEFAULT 5000,
	"last_error" text,
	"error_type" text,
	"payload_version" integer DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"result" jsonb,
	"idempotency_key" text,
	"locked_by" text,
	"locked_at" timestamp,
	"execution_generation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "workflow_optimization_recs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workflow_id" text,
	"workflow_name" text,
	"current_conversion" double precision,
	"suggested_change" text,
	"rationale" text,
	"expected_conversion" double precision,
	"confidence" double precision DEFAULT 0,
	"estimated_lift" double precision DEFAULT 0,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "workflow_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workflow_run_id" text NOT NULL,
	"workflow_type" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"outcome_type" text NOT NULL,
	"outcome_score" double precision,
	"revenue_impact" double precision,
	"retention_impact" double precision,
	"engagement_impact" double precision,
	"confidence_accuracy_delta" double precision,
	"ai_recommendation_used" boolean DEFAULT true,
	"operator_modified" boolean DEFAULT false,
	"outcome_summary" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "workflow_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workflow_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"workflow_type" text DEFAULT 'custom' NOT NULL,
	"source" text DEFAULT 'org_custom' NOT NULL,
	"protected" boolean DEFAULT false NOT NULL,
	"editable" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"system_managed" boolean DEFAULT false NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"cloned_from_workflow_id" text,
	"execution_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp,
	"last_success_at" timestamp,
	"last_failure_at" timestamp,
	"estimated_revenue_influenced" integer DEFAULT 0 NOT NULL,
	"estimated_bookings_created" integer DEFAULT 0 NOT NULL,
	"estimated_leads_converted" integer DEFAULT 0 NOT NULL,
	"workflow_definition" jsonb DEFAULT '{}'::jsonb,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"trigger_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"action_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"workflow_type" varchar,
	"display_name" varchar,
	"current_step_index" integer DEFAULT 0,
	"total_steps" integer DEFAULT 0,
	"entity_type" varchar,
	"entity_id" varchar,
	"entity_name" varchar,
	"trigger_reason" text,
	"trigger_source" varchar,
	"source_recommendation_id" varchar,
	"source_revenue_action_id" varchar,
	"context" jsonb DEFAULT '{}'::jsonb,
	"result" jsonb,
	"error" text,
	"next_check_at" timestamp,
	"locked_at" timestamp,
	"workflow_template_key" varchar,
	"source_type" varchar,
	"source_id" varchar,
	"current_step_key" varchar,
	"failed_at" timestamp,
	"failure_reason" text,
	"created_by" varchar,
	"metadata" jsonb,
	"updated_at" timestamp DEFAULT now(),
	"status" varchar DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "workflow_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"auto_start_safe_workflows" boolean DEFAULT false NOT NULL,
	"require_approval_before_messages" boolean DEFAULT true NOT NULL,
	"never_auto_send" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "workflow_settings_org_id_unique" UNIQUE("org_id")
);

CREATE TABLE "workflow_step_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_id" varchar NOT NULL,
	"step_key" varchar NOT NULL,
	"step_type" varchar NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"failed_at" timestamp,
	"output" jsonb,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"org_id" varchar NOT NULL,
	"step_index" integer NOT NULL,
	"step_name" varchar NOT NULL,
	"step_type" varchar NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"tool_call_id" varchar,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"confirmation_status" varchar,
	"confirmed_by" varchar,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "workout_adaptation_recommendations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"workout_program_id" varchar NOT NULL,
	"workout_session_id" varchar,
	"recommendation_type" varchar NOT NULL,
	"severity" varchar DEFAULT 'info' NOT NULL,
	"reason" text NOT NULL,
	"suggested_change" jsonb,
	"source" varchar DEFAULT 'rules' NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "workout_completion_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"workout_session_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"completed_at" timestamp DEFAULT now(),
	"notes" text,
	"rating" integer,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "workout_generation_metadata" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"workout_program_id" varchar NOT NULL,
	"athlete_user_id" varchar,
	"context_object_id" varchar,
	"readiness_adjustment_applied" boolean DEFAULT false,
	"compliance_adjustment_applied" boolean DEFAULT false,
	"rpe_adjustment_applied" boolean DEFAULT false,
	"readiness_trend_at_generation" varchar,
	"compliance_rate_at_generation" integer,
	"ai_rationale" text,
	"modifiers_applied" jsonb DEFAULT '[]'::jsonb,
	"generated_at" timestamp DEFAULT now()
);

CREATE TABLE "workout_program_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"workout_program_id" varchar NOT NULL,
	"assigned_to_type" varchar NOT NULL,
	"athlete_user_id" varchar,
	"team_id" varchar,
	"assigned_by_user_id" varchar NOT NULL,
	"assigned_at" timestamp DEFAULT now(),
	"status" varchar DEFAULT 'active' NOT NULL
);

CREATE TABLE "workout_programs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"program_tool_id" varchar NOT NULL,
	"created_by_user_id" varchar NOT NULL,
	"trainchat_program_id" varchar,
	"title" varchar NOT NULL,
	"description" text,
	"goal" varchar NOT NULL,
	"sport" varchar,
	"duration_weeks" integer NOT NULL,
	"days_per_week" integer NOT NULL,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"source" varchar DEFAULT 'trainchat_api' NOT NULL,
	"trainchat_raw_response" jsonb,
	"generated_summary" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "workout_readiness_checkins" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"workout_session_id" varchar,
	"readiness_score" integer NOT NULL,
	"sleep_quality" integer,
	"soreness_level" integer,
	"fatigue_level" integer,
	"stress_level" integer,
	"motivation_level" integer,
	"pain_areas" jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "workout_session_exercise_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"workout_session_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"exercise_name" varchar NOT NULL,
	"prescribed_data" jsonb,
	"completed_data" jsonb,
	"rpe" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "workout_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"workout_program_id" varchar NOT NULL,
	"week_number" integer NOT NULL,
	"day_number" integer NOT NULL,
	"title" varchar NOT NULL,
	"focus" varchar,
	"session_data" jsonb,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "workout_set_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"workout_session_id" varchar NOT NULL,
	"athlete_user_id" varchar NOT NULL,
	"exercise_index" integer DEFAULT 0 NOT NULL,
	"exercise_name" varchar(200) NOT NULL,
	"set_number" integer DEFAULT 1 NOT NULL,
	"prescribed_reps" varchar(50),
	"prescribed_load" varchar(50),
	"actual_reps" varchar(50),
	"actual_load" varchar(50),
	"rpe" integer,
	"completed" boolean DEFAULT false NOT NULL,
	"duration_seconds" integer,
	"notes" text,
	"logged_at" timestamp DEFAULT now()
);

CREATE TABLE "password_reset_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar NOT NULL,
	"user_id" varchar,
	"coach_profile_id" varchar,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);

CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"password_hash" text,
	"profile_image_url" varchar,
	"phone" varchar,
	"notes" text,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"stripe_customer_id" varchar,
	"last_sign_in_at" timestamp,
	"weekly_reminder_enabled" boolean DEFAULT true NOT NULL,
	"last_reminder_sent_at" timestamp,
	"password_reset_token" varchar,
	"password_reset_token_expires" timestamp,
	"unsubscribe_token" varchar,
	"notification_preferences" jsonb,
	"sms_opt_in" boolean DEFAULT false NOT NULL,
	"sms_opt_in_at" timestamp,
	"sms_opt_out_at" timestamp,
	"sms_consent_source" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_unsubscribe_token_unique" UNIQUE("unsubscribe_token")
);

CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "blocked_times" ADD CONSTRAINT "blocked_times_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "booking_participants" ADD CONSTRAINT "booking_participants_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "booking_participants" ADD CONSTRAINT "booking_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "cashouts" ADD CONSTRAINT "cashouts_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "coach_profiles" ADD CONSTRAINT "coach_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "credit_ledger_events" ADD CONSTRAINT "credit_ledger_events_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "credit_ledger_events" ADD CONSTRAINT "credit_ledger_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "credit_ledger_events" ADD CONSTRAINT "credit_ledger_events_subscription_id_user_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "user_subscriptions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_ledger_events" ADD CONSTRAINT "revenue_ledger_events_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_ledger_events" ADD CONSTRAINT "revenue_ledger_events_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "coach_profiles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_ledger_events" ADD CONSTRAINT "revenue_ledger_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "subscription_schedules" ADD CONSTRAINT "subscription_schedules_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_org_preferences" ADD CONSTRAINT "user_org_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "agent_jobs_org" ON "agent_jobs" USING btree ("organization_id");
CREATE INDEX "agent_jobs_status" ON "agent_jobs" USING btree ("status");
CREATE INDEX "agent_jobs_agent" ON "agent_jobs" USING btree ("agent_id");
CREATE INDEX "agent_jobs_subject" ON "agent_jobs" USING btree ("subject_type","subject_id");
CREATE INDEX "agent_jobs_remote_task" ON "agent_jobs" USING btree ("remote_task_id");
CREATE INDEX "agent_jobs_created" ON "agent_jobs" USING btree ("created_at");
CREATE UNIQUE INDEX "agent_jobs_idempotency" ON "agent_jobs" USING btree ("idempotency_key");
CREATE UNIQUE INDEX "agent_quality_scores_unique" ON "agent_quality_scores" USING btree ("org_id","agent_name","communication_domain","window_days");
CREATE UNIQUE INDEX "agent_trust_override_unique" ON "agent_trust_overrides" USING btree ("org_id","agent_name","communication_domain");
CREATE UNIQUE INDEX "kevin_capabilities_unique" ON "kevin_capabilities" USING btree ("org_id","capability");
CREATE INDEX "kevin_capabilities_org" ON "kevin_capabilities" USING btree ("org_id");
CREATE INDEX "kevin_context_requests_org" ON "kevin_context_requests" USING btree ("org_id");
CREATE INDEX "kevin_context_requests_agent" ON "kevin_context_requests" USING btree ("agent_type");
CREATE UNIQUE INDEX "kevin_events_idem" ON "kevin_events" USING btree ("idempotency_key");
CREATE INDEX "kevin_events_status" ON "kevin_events" USING btree ("status");
CREATE INDEX "kevin_events_retry" ON "kevin_events" USING btree ("next_retry_at");
CREATE INDEX "kevin_events_org" ON "kevin_events" USING btree ("org_id");
CREATE INDEX "kevin_events_type" ON "kevin_events" USING btree ("event_type");
CREATE INDEX "kevin_outcomes_org" ON "kevin_outcomes" USING btree ("org_id");
CREATE INDEX "kevin_outcomes_signal" ON "kevin_outcomes" USING btree ("signal_id");
CREATE INDEX "kevin_outcomes_forward" ON "kevin_outcomes" USING btree ("forward_status");
CREATE UNIQUE INDEX "kevin_rate_limits_window" ON "kevin_rate_limits" USING btree ("org_id","user_id","window_start");
CREATE INDEX "kevin_signals_org" ON "kevin_signals" USING btree ("org_id");
CREATE INDEX "kevin_signals_status" ON "kevin_signals" USING btree ("status");
CREATE INDEX "kevin_signals_risk" ON "kevin_signals" USING btree ("risk_class");
CREATE INDEX "raa_org" ON "retention_agent_analyses" USING btree ("organization_id");
CREATE INDEX "raa_client" ON "retention_agent_analyses" USING btree ("client_id");
CREATE UNIQUE INDEX "raa_job" ON "retention_agent_analyses" USING btree ("agent_job_id");
CREATE UNIQUE INDEX "team_lead_settings_org_unique" ON "team_training_lead_settings" USING btree ("organization_id");
CREATE UNIQUE INDEX "user_org_prefs_unique" ON "user_org_preferences" USING btree ("user_id","org_id");
CREATE UNIQUE INDEX "workflow_job_effects_identity_unique" ON "workflow_job_effects" USING btree ("org_id","workflow_job_id","effect_key","execution_generation");
CREATE UNIQUE INDEX "workflow_jobs_org_idempotency_key_unique" ON "workflow_jobs" USING btree ("org_id","idempotency_key");
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");
