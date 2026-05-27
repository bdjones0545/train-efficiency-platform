import { db } from "./db";
import { workflowRegistry, type InsertWorkflowRegistry } from "../shared/schema";
import { eq, and } from "drizzle-orm";

// ─── Node builder helpers ─────────────────────────────────────────────────────

function n(id: string, nodeType: string, label: string, x: number, y: number, riskLevel = "low", extra: any = {}) {
  return {
    id,
    type: "workflowNode",
    position: { x, y },
    data: { label, nodeType, riskLevel, requiresApproval: riskLevel === "high" || riskLevel === "critical", ...extra },
  };
}

function e(id: string, source: string, target: string) {
  return { id, source, target, markerEnd: { type: "arrowclosed" }, style: { strokeWidth: 1.5 } };
}

// ─── 10 system workflow definitions ──────────────────────────────────────────

const SYSTEM_WORKFLOWS: Omit<InsertWorkflowRegistry, "orgId">[] = [
  {
    workflowKey: "sys_lead_intake_pipeline",
    name: "Lead Intake Pipeline",
    description: "Automatically qualifies and routes new leads from Meta/web sources through research, scoring, and approval-gated outreach.",
    workflowType: "lead_pipeline",
    source: "system",
    protected: true,
    editable: false,
    enabled: true,
    systemManaged: true,
    version: "1.0.0",
    tags: ["lead", "intake", "qualification", "meta"],
    triggerTypes: ["meta_lead_trigger", "webhook_trigger"],
    actionTypes: ["research_lead", "generate_recommendation", "approval_gate", "send_email"],
    workflowDefinition: {
      nodes: [
        n("t1", "meta_lead_trigger", "Meta Lead Received", 50, 50),
        n("a1", "research_lead", "Research Lead", 250, 50, "high", { agentType: "research_agent" }),
        n("l1", "if_else", "Qualified?", 450, 50),
        n("h1", "approval_gate", "Approval Gate", 650, 0, "medium"),
        n("a2", "send_email", "Send Welcome Email", 850, 0, "high", { agentType: "communication_agent" }),
        n("o1", "workflow_completed", "Lead Qualified ✓", 1050, 0),
        n("o2", "workflow_failed", "Disqualified ✗", 650, 120),
      ],
      edges: [
        e("e1","t1","a1"), e("e2","a1","l1"), e("e3","l1","h1"),
        e("e4","l1","o2"), e("e5","h1","a2"), e("e6","a2","o1"),
      ],
    },
    createdBy: "system",
  },
  {
    workflowKey: "sys_gmail_reply_recovery",
    name: "Gmail Reply Recovery",
    description: "Monitors Gmail threads, classifies replies using AI, and routes responses to the appropriate recovery or booking flow.",
    workflowType: "automation",
    source: "system",
    protected: true,
    editable: false,
    enabled: true,
    systemManaged: true,
    version: "1.0.0",
    tags: ["gmail", "reply", "recovery", "email"],
    triggerTypes: ["gmail_reply_trigger"],
    actionTypes: ["classify_reply", "summarize_thread", "send_email"],
    workflowDefinition: {
      nodes: [
        n("t1", "gmail_reply_trigger", "Gmail Reply Received", 50, 80),
        n("a1", "classify_reply", "Classify Reply", 250, 80, "low", { agentType: "communication_agent" }),
        n("a2", "summarize_thread", "Summarize Thread", 450, 80, "low", { agentType: "communication_agent" }),
        n("l1", "if_else", "Positive Intent?", 650, 80),
        n("a3", "send_email", "Send Follow-Up", 850, 0, "high", { agentType: "communication_agent" }),
        n("o1", "workflow_completed", "Replied ✓", 1050, 0),
        n("o2", "workflow_escalated", "Escalated for Review", 850, 160),
      ],
      edges: [
        e("e1","t1","a1"), e("e2","a1","a2"), e("e3","a2","l1"),
        e("e4","l1","a3"), e("e5","l1","o2"), e("e6","a3","o1"),
      ],
    },
    createdBy: "system",
  },
  {
    workflowKey: "sys_intelligent_lead_scoring",
    name: "Intelligent Lead Scoring",
    description: "Enriches inbound leads with web research, scores them with AI, and segments them into pipeline priority tiers.",
    workflowType: "lead_pipeline",
    source: "system",
    protected: true,
    editable: false,
    enabled: true,
    systemManaged: true,
    version: "1.0.0",
    tags: ["scoring", "enrichment", "lead", "AI"],
    triggerTypes: ["webhook_trigger"],
    actionTypes: ["research_lead", "generate_recommendation"],
    workflowDefinition: {
      nodes: [
        n("t1", "webhook_trigger", "Lead Webhook", 50, 80),
        n("a1", "research_lead", "Research & Enrich", 250, 80, "high", { agentType: "research_agent" }),
        n("a2", "generate_recommendation", "AI Score", 450, 80, "low", { agentType: "system_agent" }),
        n("l1", "confidence_threshold", "Score ≥ 70?", 650, 80),
        n("o1", "client_converted", "High Priority Lead", 850, 0),
        n("o2", "workflow_completed", "Low Priority Queued", 850, 160),
      ],
      edges: [
        e("e1","t1","a1"), e("e2","a1","a2"), e("e3","a2","l1"),
        e("e4","l1","o1"), e("e5","l1","o2"),
      ],
    },
    createdBy: "system",
  },
  {
    workflowKey: "sys_scheduling_agent",
    name: "Scheduling Agent",
    description: "Recommends optimal session times, gets operator approval, then creates confirmed bookings in the calendar.",
    workflowType: "scheduling",
    source: "system",
    protected: true,
    editable: false,
    enabled: true,
    systemManaged: true,
    version: "1.0.0",
    tags: ["scheduling", "booking", "calendar"],
    triggerTypes: ["manual_trigger", "webhook_trigger"],
    actionTypes: ["generate_recommendation", "approval_gate", "create_booking"],
    workflowDefinition: {
      nodes: [
        n("t1", "manual_trigger", "Manual Trigger", 50, 80),
        n("a1", "generate_recommendation", "Find Available Slots", 250, 80, "low", { agentType: "system_agent" }),
        n("l1", "if_else", "Slots Available?", 450, 80),
        n("h1", "approval_gate", "Coach Confirms Slot", 650, 0, "medium"),
        n("a2", "create_booking", "Create Booking", 850, 0, "high", { agentType: "scheduling_agent" }),
        n("o1", "session_booked", "Session Booked ✓", 1050, 0),
        n("o2", "workflow_failed", "No Slots Available", 650, 160),
      ],
      edges: [
        e("e1","t1","a1"), e("e2","a1","l1"), e("e3","l1","h1"),
        e("e4","l1","o2"), e("e5","h1","a2"), e("e6","a2","o1"),
      ],
    },
    createdBy: "system",
  },
  {
    workflowKey: "sys_recovery_followup_cron",
    name: "Recovery Follow-Up Cron",
    description: "Scheduled daily sweep that identifies lapsed clients and queues personalized re-engagement emails for coach review.",
    workflowType: "recovery",
    source: "system",
    protected: true,
    editable: false,
    enabled: true,
    systemManaged: true,
    version: "1.0.0",
    tags: ["recovery", "cron", "follow-up", "retention"],
    triggerTypes: ["schedule_trigger"],
    actionTypes: ["generate_recommendation", "send_email"],
    workflowDefinition: {
      nodes: [
        n("t1", "schedule_trigger", "Daily 8AM", 50, 80),
        n("a1", "generate_recommendation", "Find Lapsed Clients", 250, 80, "low", { agentType: "system_agent" }),
        n("l1", "if_else", "Clients Found?", 450, 80),
        n("l2", "rate_limit_gate", "Rate Limit (10/day)", 650, 0),
        n("a2", "send_email", "Queue Re-Engagement Email", 850, 0, "high", { agentType: "communication_agent" }),
        n("o1", "workflow_completed", "Follow-Ups Queued ✓", 1050, 0),
        n("o2", "workflow_completed", "No Action Needed", 650, 160),
      ],
      edges: [
        e("e1","t1","a1"), e("e2","a1","l1"), e("e3","l1","l2"),
        e("e4","l1","o2"), e("e5","l2","a2"), e("e6","a2","o1"),
      ],
    },
    createdBy: "system",
  },
  {
    workflowKey: "sys_booking_confirmation_flow",
    name: "Booking Confirmation Flow",
    description: "Fires immediately after a booking is confirmed, sending a branded confirmation email with session details to the client.",
    workflowType: "scheduling",
    source: "system",
    protected: true,
    editable: false,
    enabled: true,
    systemManaged: true,
    version: "1.0.0",
    tags: ["booking", "confirmation", "email"],
    triggerTypes: ["webhook_trigger"],
    actionTypes: ["send_email"],
    workflowDefinition: {
      nodes: [
        n("t1", "webhook_trigger", "Booking Confirmed Event", 50, 80),
        n("a1", "generate_recommendation", "Build Confirmation Context", 250, 80, "low", { agentType: "system_agent" }),
        n("a2", "send_email", "Send Confirmation Email", 450, 80, "high", { agentType: "communication_agent" }),
        n("o1", "workflow_completed", "Confirmation Sent ✓", 650, 80),
      ],
      edges: [
        e("e1","t1","a1"), e("e2","a1","a2"), e("e3","a2","o1"),
      ],
    },
    createdBy: "system",
  },
  {
    workflowKey: "sys_payment_failure_recovery",
    name: "Payment Failure Recovery",
    description: "Detects failed payments, checks client history, routes through approval, and sends a sensitive payment resolution email.",
    workflowType: "recovery",
    source: "system",
    protected: true,
    editable: false,
    enabled: true,
    systemManaged: true,
    version: "1.0.0",
    tags: ["payment", "recovery", "billing"],
    triggerTypes: ["payment_failed_trigger"],
    actionTypes: ["generate_recommendation", "approval_gate", "send_email"],
    workflowDefinition: {
      nodes: [
        n("t1", "payment_failed_trigger", "Payment Failed Event", 50, 80),
        n("a1", "generate_recommendation", "Assess Client History", 250, 80, "low", { agentType: "system_agent" }),
        n("l1", "if_else", "High Value Client?", 450, 80),
        n("h1", "approval_gate", "Coach Review", 650, 0, "medium"),
        n("a2", "send_email", "Send Payment Recovery", 850, 0, "high", { agentType: "communication_agent" }),
        n("o1", "workflow_completed", "Recovery Sent ✓", 1050, 0),
        n("o2", "send_email", "Send Standard Notice", 650, 160, "high", { agentType: "communication_agent" }),
        n("o3", "workflow_completed", "Notice Sent ✓", 850, 160),
      ],
      edges: [
        e("e1","t1","a1"), e("e2","a1","l1"), e("e3","l1","h1"),
        e("e4","l1","o2"), e("e5","h1","a2"), e("e6","a2","o1"),
        e("e7","o2","o3"),
      ],
    },
    createdBy: "system",
  },
  {
    workflowKey: "sys_lead_reengagement",
    name: "Lead Re-Engagement",
    description: "Identifies leads that went cold (30+ days no response) and generates fresh personalized outreach using updated research.",
    workflowType: "outreach",
    source: "system",
    protected: true,
    editable: false,
    enabled: true,
    systemManaged: true,
    version: "1.0.0",
    tags: ["re-engagement", "cold-leads", "outreach"],
    triggerTypes: ["schedule_trigger"],
    actionTypes: ["research_lead", "send_email"],
    workflowDefinition: {
      nodes: [
        n("t1", "schedule_trigger", "Weekly Sweep", 50, 80),
        n("a1", "research_lead", "Re-Enrich Cold Leads", 250, 80, "high", { agentType: "research_agent" }),
        n("l1", "if_else", "Still Reachable?", 450, 80),
        n("l2", "rate_limit_gate", "Rate Limit (5/day)", 650, 0),
        n("a2", "send_email", "Send Fresh Outreach", 850, 0, "high", { agentType: "communication_agent" }),
        n("o1", "workflow_completed", "Re-Engaged ✓", 1050, 0),
        n("o2", "workflow_failed", "Lead Suppressed", 650, 160),
      ],
      edges: [
        e("e1","t1","a1"), e("e2","a1","l1"), e("e3","l1","l2"),
        e("e4","l1","o2"), e("e5","l2","a2"), e("e6","a2","o1"),
      ],
    },
    createdBy: "system",
  },
  {
    workflowKey: "sys_autonomy_policy_enforcement",
    name: "Autonomy Policy Enforcement",
    description: "Intercepts high-risk agent actions, evaluates them against the org autonomy policy, and blocks or escalates violations.",
    workflowType: "governance",
    source: "system",
    protected: true,
    editable: false,
    enabled: true,
    systemManaged: true,
    version: "1.0.0",
    tags: ["governance", "autonomy", "policy", "safety"],
    triggerTypes: ["webhook_trigger"],
    actionTypes: ["escalate_admin"],
    workflowDefinition: {
      nodes: [
        n("t1", "webhook_trigger", "High-Risk Action Detected", 50, 80),
        n("l1", "confidence_threshold", "Policy Check", 250, 80),
        n("l2", "if_else", "Within Policy?", 450, 80),
        n("o1", "workflow_completed", "Action Approved ✓", 650, 0),
        n("h1", "escalate_admin", "Escalate to Admin", 650, 160, "critical"),
        n("h2", "manual_review", "Manual Review", 850, 160, "medium"),
        n("o2", "workflow_completed", "Action Blocked ✓", 1050, 160),
      ],
      edges: [
        e("e1","t1","l1"), e("e2","l1","l2"), e("e3","l2","o1"),
        e("e4","l2","h1"), e("e5","h1","h2"), e("e6","h2","o2"),
      ],
    },
    createdBy: "system",
  },
  {
    workflowKey: "sys_athlete_reactivation",
    name: "Athlete Reactivation Workflow",
    description: "Identifies inactive athletes (60+ days), generates a personalized reactivation offer, and books a complimentary re-assessment.",
    workflowType: "retention",
    source: "system",
    protected: true,
    editable: false,
    enabled: true,
    systemManaged: true,
    version: "1.0.0",
    tags: ["retention", "reactivation", "athlete", "booking"],
    triggerTypes: ["schedule_trigger"],
    actionTypes: ["generate_recommendation", "send_email", "create_booking"],
    workflowDefinition: {
      nodes: [
        n("t1", "schedule_trigger", "Monthly Sweep", 50, 80),
        n("a1", "generate_recommendation", "Find Inactive Athletes", 250, 80, "low", { agentType: "system_agent" }),
        n("l1", "if_else", "Athletes Found?", 450, 80),
        n("a2", "send_email", "Send Reactivation Offer", 650, 0, "high", { agentType: "communication_agent" }),
        n("l2", "wait_delay", "Wait 48h", 850, 0),
        n("l3", "if_else", "Positive Reply?", 1050, 0),
        n("a3", "create_booking", "Book Re-Assessment", 1250, 0, "high", { agentType: "scheduling_agent" }),
        n("o1", "client_retained", "Athlete Reactivated ✓", 1450, 0),
        n("o2", "workflow_completed", "No Response", 1250, 120),
        n("o3", "workflow_completed", "No Inactive Athletes", 650, 160),
      ],
      edges: [
        e("e1","t1","a1"), e("e2","a1","l1"), e("e3","l1","a2"),
        e("e4","l1","o3"), e("e5","a2","l2"), e("e6","l2","l3"),
        e("e7","l3","a3"), e("e8","a3","o1"), e("e9","l3","o2"),
      ],
    },
    createdBy: "system",
  },
];

// ─── Template workflows ────────────────────────────────────────────────────────

const TEMPLATE_WORKFLOWS: Omit<InsertWorkflowRegistry, "orgId">[] = [
  {
    workflowKey: "tpl_hot_lead_conversion",
    name: "Hot Lead Conversion",
    description: "High-urgency template for converting inbound hot leads within 24 hours using rapid research and same-day outreach.",
    workflowType: "lead_pipeline",
    source: "template",
    protected: false,
    editable: true,
    enabled: false,
    systemManaged: false,
    version: "1.0.0",
    tags: ["template", "hot-lead", "urgent"],
    triggerTypes: ["meta_lead_trigger"],
    actionTypes: ["research_lead", "send_email", "create_booking"],
    workflowDefinition: {
      nodes: [
        n("t1", "meta_lead_trigger", "Hot Lead In", 50, 80),
        n("a1", "research_lead", "Rapid Research", 250, 80, "high", { agentType: "research_agent" }),
        n("h1", "approval_gate", "Coach Reviews", 450, 80, "medium"),
        n("a2", "send_email", "Send Immediate Outreach", 650, 80, "high", { agentType: "communication_agent" }),
        n("o1", "client_converted", "Converted ✓", 850, 80),
      ],
      edges: [e("e1","t1","a1"), e("e2","a1","h1"), e("e3","h1","a2"), e("e4","a2","o1")],
    },
    createdBy: "system",
  },
  {
    workflowKey: "tpl_missed_session_recovery",
    name: "Missed Session Recovery",
    description: "Reaches out to clients who missed a session with a reschedule offer and motivational message.",
    workflowType: "recovery",
    source: "template",
    protected: false,
    editable: true,
    enabled: false,
    systemManaged: false,
    version: "1.0.0",
    tags: ["template", "missed-session", "reschedule"],
    triggerTypes: ["booking_cancelled_trigger"],
    actionTypes: ["send_email", "create_booking"],
    workflowDefinition: {
      nodes: [
        n("t1", "booking_cancelled_trigger", "Session Missed/Cancelled", 50, 80),
        n("l1", "wait_delay", "Wait 2 Hours", 250, 80),
        n("a1", "send_email", "Send Reschedule Offer", 450, 80, "high", { agentType: "communication_agent" }),
        n("o1", "session_booked", "Rescheduled ✓", 650, 80),
      ],
      edges: [e("e1","t1","l1"), e("e2","l1","a1"), e("e3","a1","o1")],
    },
    createdBy: "system",
  },
  {
    workflowKey: "tpl_summer_sprint_funnel",
    name: "Summer Sprint Funnel",
    description: "Seasonal campaign template for converting leads with summer program offers. Includes urgency messaging and limited-time booking.",
    workflowType: "outreach",
    source: "template",
    protected: false,
    editable: true,
    enabled: false,
    systemManaged: false,
    version: "1.0.0",
    tags: ["template", "seasonal", "campaign", "summer"],
    triggerTypes: ["manual_trigger", "webhook_trigger"],
    actionTypes: ["research_lead", "send_email", "create_booking"],
    workflowDefinition: {
      nodes: [
        n("t1", "manual_trigger", "Launch Campaign", 50, 80),
        n("a1", "research_lead", "Segment Leads", 250, 80, "high", { agentType: "research_agent" }),
        n("l1", "rate_limit_gate", "Rate Limit (20/day)", 450, 80),
        n("h1", "approval_gate", "Coach Approves Batch", 650, 80, "medium"),
        n("a2", "send_email", "Send Summer Offer", 850, 80, "high", { agentType: "communication_agent" }),
        n("l2", "wait_delay", "Wait 72h", 1050, 80),
        n("l3", "if_else", "Replied?", 1250, 80),
        n("a3", "create_booking", "Book Intro Session", 1450, 0, "high", { agentType: "scheduling_agent" }),
        n("o1", "client_converted", "Enrolled ✓", 1650, 0),
        n("o2", "workflow_completed", "No Reply", 1450, 160),
      ],
      edges: [
        e("e1","t1","a1"), e("e2","a1","l1"), e("e3","l1","h1"),
        e("e4","h1","a2"), e("e5","a2","l2"), e("e6","l2","l3"),
        e("e7","l3","a3"), e("e8","a3","o1"), e("e9","l3","o2"),
      ],
    },
    createdBy: "system",
  },
  {
    workflowKey: "tpl_no_reply_recovery",
    name: "No-Reply Recovery",
    description: "Multi-touch follow-up sequence for leads who haven't responded after initial outreach.",
    workflowType: "outreach",
    source: "template",
    protected: false,
    editable: true,
    enabled: false,
    systemManaged: false,
    version: "1.0.0",
    tags: ["template", "no-reply", "follow-up", "sequence"],
    triggerTypes: ["schedule_trigger"],
    actionTypes: ["send_email"],
    workflowDefinition: {
      nodes: [
        n("t1", "schedule_trigger", "Day 3 Check", 50, 80),
        n("l1", "if_else", "No Reply?", 250, 80),
        n("a1", "send_email", "Follow-Up #1", 450, 0, "high", { agentType: "communication_agent" }),
        n("l2", "wait_delay", "Wait 48h", 650, 0),
        n("a2", "send_email", "Follow-Up #2", 850, 0, "high", { agentType: "communication_agent" }),
        n("o1", "workflow_completed", "Sequence Complete ✓", 1050, 0),
        n("o2", "workflow_completed", "Already Replied", 450, 160),
      ],
      edges: [
        e("e1","t1","l1"), e("e2","l1","a1"), e("e3","a1","l2"),
        e("e4","l2","a2"), e("e5","a2","o1"), e("e6","l1","o2"),
      ],
    },
    createdBy: "system",
  },
];

export const ALL_SEEDED_WORKFLOWS = [...SYSTEM_WORKFLOWS, ...TEMPLATE_WORKFLOWS];

// ─── Seeder function ──────────────────────────────────────────────────────────

export async function seedSystemWorkflows(orgId: string): Promise<{ seeded: number; skipped: number }> {
  let seeded = 0;
  let skipped = 0;

  for (const wf of ALL_SEEDED_WORKFLOWS) {
    const existing = await db
      .select({ id: workflowRegistry.id })
      .from(workflowRegistry)
      .where(and(eq(workflowRegistry.orgId, orgId), eq(workflowRegistry.workflowKey, wf.workflowKey)))
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    await db.insert(workflowRegistry).values({
      ...wf,
      orgId,
    });
    seeded++;
  }

  return { seeded, skipped };
}

export async function seedAllOrgs(): Promise<void> {
  try {
    const { db: dbConn } = await import("./db");
    const { organizations } = await import("../shared/schema");
    const orgs = await dbConn.select({ id: organizations.id }).from(organizations);
    let total = 0;
    for (const org of orgs) {
      const { seeded } = await seedSystemWorkflows(org.id);
      total += seeded;
    }
    if (total > 0) {
      console.log(`[WorkflowRegistry] Seeded ${total} workflows across ${orgs.length} orgs`);
    }
  } catch (err: any) {
    console.error("[WorkflowRegistry] Seed error:", err.message);
  }
}
