import { z } from "zod";

export type ToolCategory = "communication" | "scheduling" | "crm" | "financial" | "internal";

export type ToolPermissions = {
  safe_auto_execute: boolean;
  requires_confirmation: boolean;
  admin_only: boolean;
  external_side_effect: boolean;
  financial_side_effect: boolean;
  client_visible: boolean;
};

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ConnectorStatus = "live" | "stub" | "planned";

export type ToolDefinition = {
  name: string;
  description: string;
  category: ToolCategory;
  permissions: ToolPermissions;
  riskLevel: RiskLevel;
  inputSchema: z.ZodObject<any>;
  connector: string;
  connectorStatus: ConnectorStatus;
};

const P = (overrides: Partial<ToolPermissions>): ToolPermissions => ({
  safe_auto_execute: false,
  requires_confirmation: false,
  admin_only: false,
  external_side_effect: false,
  financial_side_effect: false,
  client_visible: false,
  ...overrides,
});

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {

  send_email: {
    name: "send_email",
    description: "Send an email to a contact via SendGrid. Client-visible. Cannot be undone.",
    category: "communication",
    permissions: P({ requires_confirmation: true, external_side_effect: true, client_visible: true }),
    riskLevel: "medium",
    connector: "sendgrid",
    connectorStatus: "live",
    inputSchema: z.object({
      to: z.string().email(),
      subject: z.string().min(1).max(200),
      html: z.string().min(1),
      senderName: z.string().optional(),
      replyTo: z.string().email().optional(),
      orgId: z.string(),
      agentActionId: z.string().optional(),
      recipientUserId: z.string().optional(),
    }),
  },

  send_sms: {
    name: "send_sms",
    description: "Send an SMS to a contact via Twilio. Requires explicit opt-in. Client-visible. Cannot be undone.",
    category: "communication",
    permissions: P({ requires_confirmation: true, external_side_effect: true, client_visible: true }),
    riskLevel: "medium",
    connector: "twilio",
    connectorStatus: "live",
    inputSchema: z.object({
      to: z.string().min(10),
      body: z.string().min(1).max(1600),
      orgId: z.string(),
      agentActionId: z.string().optional(),
      recipientUserId: z.string().optional(),
    }),
  },

  create_email_draft: {
    name: "create_email_draft",
    description: "Create an email draft for human review before sending. Safe to auto-execute.",
    category: "communication",
    permissions: P({ safe_auto_execute: true }),
    riskLevel: "low",
    connector: "internal",
    connectorStatus: "live",
    inputSchema: z.object({
      prospectId: z.string().optional(),
      dealId: z.string().optional(),
      recipientEmail: z.string().email().optional(),
      recipientName: z.string().optional(),
      subject: z.string().min(1).max(200),
      body: z.string().min(1),
      draftType: z.enum(["outreach", "follow_up", "re_engage", "proposal", "general"]).default("general"),
      notes: z.string().optional(),
    }),
  },

  create_sms_draft: {
    name: "create_sms_draft",
    description: "Create an SMS draft for human review. Safe to auto-execute.",
    category: "communication",
    permissions: P({ safe_auto_execute: true }),
    riskLevel: "low",
    connector: "internal",
    connectorStatus: "live",
    inputSchema: z.object({
      recipientPhone: z.string().optional(),
      recipientName: z.string().optional(),
      body: z.string().min(1).max(1600),
      draftType: z.enum(["follow_up", "reminder", "re_engage", "general"]).default("general"),
    }),
  },

  create_calendar_event: {
    name: "create_calendar_event",
    description: "Create a calendar event. Requires confirmation. Google Calendar connector planned.",
    category: "scheduling",
    permissions: P({ requires_confirmation: true, external_side_effect: true }),
    riskLevel: "medium",
    connector: "google_calendar",
    connectorStatus: "planned",
    inputSchema: z.object({
      title: z.string().min(1),
      startIso: z.string(),
      endIso: z.string(),
      description: z.string().optional(),
      attendeeEmails: z.array(z.string().email()).optional(),
      location: z.string().optional(),
    }),
  },

  create_follow_up_task: {
    name: "create_follow_up_task",
    description: "Schedule a follow-up reminder task for a prospect or deal. Safe to auto-execute.",
    category: "crm",
    permissions: P({ safe_auto_execute: true }),
    riskLevel: "low",
    connector: "internal",
    connectorStatus: "live",
    inputSchema: z.object({
      prospectId: z.string().optional(),
      dealId: z.string().optional(),
      followUpDate: z.string(),
      note: z.string().optional(),
      priority: z.enum(["low", "medium", "high"]).default("medium"),
    }),
  },

  update_deal_stage: {
    name: "update_deal_stage",
    description: "Update the stage of a deal in the pipeline. Safe for stage advances; requires confirmation to mark won/lost.",
    category: "crm",
    permissions: P({ safe_auto_execute: true }),
    riskLevel: "medium",
    connector: "internal",
    connectorStatus: "live",
    inputSchema: z.object({
      dealId: z.string(),
      newStage: z.enum(["prospecting", "contacted", "proposal", "negotiation", "closed_won", "closed_lost"]),
      note: z.string().optional(),
    }),
  },

  update_lead_status: {
    name: "update_lead_status",
    description: "Update the status of a prospecting lead. Safe to auto-execute for non-destructive transitions.",
    category: "crm",
    permissions: P({ safe_auto_execute: true }),
    riskLevel: "low",
    connector: "internal",
    connectorStatus: "live",
    inputSchema: z.object({
      prospectId: z.string(),
      newStatus: z.string().min(1),
      note: z.string().optional(),
    }),
  },

  log_activity: {
    name: "log_activity",
    description: "Log an activity against a deal or prospect. Safe to auto-execute.",
    category: "crm",
    permissions: P({ safe_auto_execute: true }),
    riskLevel: "low",
    connector: "internal",
    connectorStatus: "live",
    inputSchema: z.object({
      dealId: z.string(),
      activityType: z.enum(["email", "call", "meeting", "note", "stage_change", "other"]),
      summary: z.string().min(1),
      metadata: z.record(z.any()).optional(),
    }),
  },

  create_invoice: {
    name: "create_invoice",
    description: "Create a payment invoice via Stripe. Admin only. Requires confirmation. Financial side effect.",
    category: "financial",
    permissions: P({ requires_confirmation: true, admin_only: true, financial_side_effect: true, client_visible: true }),
    riskLevel: "high",
    connector: "stripe",
    connectorStatus: "stub",
    inputSchema: z.object({
      clientId: z.string(),
      amountCents: z.number().int().positive(),
      description: z.string().min(1),
      dueDate: z.string().optional(),
    }),
  },

  record_payment: {
    name: "record_payment",
    description: "Record a manual payment. Admin only. Requires confirmation. Financial side effect. Cannot be undone.",
    category: "financial",
    permissions: P({ requires_confirmation: true, admin_only: true, financial_side_effect: true }),
    riskLevel: "critical",
    connector: "stripe",
    connectorStatus: "stub",
    inputSchema: z.object({
      clientId: z.string(),
      amountCents: z.number().int().positive(),
      paymentMethod: z.string(),
      description: z.string().optional(),
    }),
  },

  update_client_status: {
    name: "update_client_status",
    description: "Update a client's active status. Requires confirmation since it affects their access.",
    category: "crm",
    permissions: P({ requires_confirmation: true, client_visible: true }),
    riskLevel: "medium",
    connector: "internal",
    connectorStatus: "live",
    inputSchema: z.object({
      clientId: z.string(),
      newStatus: z.enum(["active", "inactive", "suspended", "at_risk", "churned"]),
      reason: z.string().optional(),
    }),
  },

  create_schedule_slot: {
    name: "create_schedule_slot",
    description: "Create an open availability slot for a coach. Requires confirmation before publishing.",
    category: "scheduling",
    permissions: P({ requires_confirmation: true }),
    riskLevel: "medium",
    connector: "internal",
    connectorStatus: "live",
    inputSchema: z.object({
      coachId: z.string(),
      startIso: z.string(),
      endIso: z.string(),
      serviceId: z.string().optional(),
      notes: z.string().optional(),
    }),
  },

  book_session: {
    name: "book_session",
    description: "Book a session for a client. Requires confirmation. Client will be notified.",
    category: "scheduling",
    permissions: P({ requires_confirmation: true, client_visible: true }),
    riskLevel: "high",
    connector: "internal",
    connectorStatus: "live",
    inputSchema: z.object({
      clientId: z.string(),
      coachId: z.string(),
      serviceId: z.string(),
      startIso: z.string(),
      endIso: z.string(),
    }),
  },

  cancel_session: {
    name: "cancel_session",
    description: "Cancel an existing session. Requires confirmation. Client will be notified. Cannot be undone.",
    category: "scheduling",
    permissions: P({ requires_confirmation: true, client_visible: true }),
    riskLevel: "critical",
    connector: "internal",
    connectorStatus: "live",
    inputSchema: z.object({
      bookingId: z.string(),
      reason: z.string().min(1),
      notifyClient: z.boolean().default(true),
    }),
  },

  reschedule_session: {
    name: "reschedule_session",
    description: "Reschedule an existing session to a new time. Requires confirmation. Client will be notified.",
    category: "scheduling",
    permissions: P({ requires_confirmation: true, client_visible: true }),
    riskLevel: "high",
    connector: "internal",
    connectorStatus: "live",
    inputSchema: z.object({
      bookingId: z.string(),
      newStartIso: z.string(),
      newEndIso: z.string(),
      reason: z.string().optional(),
    }),
  },
};

export const CONNECTOR_ROADMAP = [
  { name: "Google Calendar", status: "planned" as ConnectorStatus, description: "Two-way sync for session scheduling", tools: ["create_calendar_event"] },
  { name: "Stripe", status: "stub" as ConnectorStatus, description: "Invoicing, payment links, subscription billing", tools: ["create_invoice", "record_payment"] },
  { name: "Gmail / Outlook", status: "planned" as ConnectorStatus, description: "Send emails from coach's own inbox", tools: ["send_email"] },
  { name: "Meta Ads", status: "planned" as ConnectorStatus, description: "Trigger ad campaigns from AI actions", tools: [] },
  { name: "Google Analytics", status: "planned" as ConnectorStatus, description: "Track conversion events from AI actions", tools: [] },
  { name: "HubSpot / CRM", status: "planned" as ConnectorStatus, description: "Bidirectional contact and deal sync", tools: ["update_lead_status", "update_deal_stage"] },
  { name: "Zapier / Webhooks", status: "planned" as ConnectorStatus, description: "Trigger any external workflow from an agent action", tools: [] },
  { name: "QuickBooks", status: "planned" as ConnectorStatus, description: "Sync invoices and payments to accounting", tools: ["create_invoice", "record_payment"] },
  { name: "Slack", status: "planned" as ConnectorStatus, description: "Notify coaches on high-priority actions", tools: [] },
];

export function getTool(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY[name];
}

export function listTools(): ToolDefinition[] {
  return Object.values(TOOL_REGISTRY);
}
