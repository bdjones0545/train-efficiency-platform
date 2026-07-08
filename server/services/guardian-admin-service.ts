/**
 * Guardian Admin Service — Phase 8
 * ──────────────────────────────────
 * Admin-facing guardian management: list, detail, communication timeline,
 * preferences, welcome draft queueing, and guardian metrics for CEO Heartbeat.
 *
 * Key design decisions:
 *   - Parents are contacts, not athletes — everything references back to the athlete
 *   - No duplicate guardian records — grouped by guardianUserId / inviteEmail
 *   - Preferences live in guardian_communication_preferences (raw SQL table)
 *   - PAIL guardian context stored in preferences table as pailContext (text)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GuardianPreferences {
  id?: string;
  guardianUserId: string;
  orgId: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  marketingEnabled: boolean;
  evaluationReminders: boolean;
  scheduleNotifications: boolean;
  programUpdates: boolean;
  preferredContactMethod: string;
  pailContext: string | null;
  updatedAt: string | null;
}

export interface GuardianTimelineEvent {
  id: string;
  type:
    | "invitation_sent"
    | "invitation_accepted"
    | "invitation_pending"
    | "welcome_draft_queued"
    | "welcome_draft_approved"
    | "email_sent"
    | "notification_sent"
    | "invite_resent"
    | "system_event";
  title: string;
  description: string;
  date: string;
  athleteUserId?: string;
  metadata?: Record<string, any>;
}

export interface GuardianAlert {
  key: string;
  type: "invite_pending" | "never_contacted" | "prefs_incomplete" | "missing_youth" | "invite_stalled";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  message: string;
  guardianEmail: string;
  athleteUserId: string;
  linkId: string;
  ageHours: number;
  actionLabel: string;
  actionUrl: string;
}

export interface GuardianRecord {
  guardianUserId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  lastSignInAt: string | null;
  inviteStatus: "no_invite" | "pending" | "active" | "revoked";
  athleteCount: number;
  linkedAthletes: { athleteUserId: string; athleteName: string; status: string; createdAt: string | null; activatedAt: string | null; linkId: string }[];
  lastCommunicationAt: string | null;
  alertCount: number;
  alerts: GuardianAlert[];
  preferences?: GuardianPreferences | null;
}

export interface GuardianMetrics {
  totalGuardians: number;
  pendingInvites: number;
  activeGuardians: number;
  neverContacted: number;
  incompletePreferences: number;
  familiesMultipleAthletes: number;
  acceptanceRate: number;
}

// ─── Table init ───────────────────────────────────────────────────────────────

let _tableEnsured = false;

export async function ensureGuardianPrefsTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS guardian_communication_preferences (
        id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
        guardian_user_id text NOT NULL,
        org_id        text NOT NULL,
        email_enabled boolean NOT NULL DEFAULT true,
        sms_enabled   boolean NOT NULL DEFAULT false,
        marketing_enabled boolean NOT NULL DEFAULT false,
        evaluation_reminders boolean NOT NULL DEFAULT true,
        schedule_notifications boolean NOT NULL DEFAULT true,
        program_updates boolean NOT NULL DEFAULT true,
        preferred_contact_method text NOT NULL DEFAULT 'email',
        pail_context  text,
        updated_at    timestamp DEFAULT now(),
        UNIQUE(guardian_user_id, org_id)
      )
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.warn("[GuardianAdmin] ensureGuardianPrefsTable:", err.message);
  }
}

// ─── Preferences ─────────────────────────────────────────────────────────────

export async function getGuardianPreferences(
  guardianUserId: string,
  orgId: string
): Promise<GuardianPreferences | null> {
  await ensureGuardianPrefsTable();
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(sql`
      SELECT * FROM guardian_communication_preferences
      WHERE guardian_user_id = ${guardianUserId} AND org_id = ${orgId}
      LIMIT 1
    `);
    const r = Array.isArray(rows) ? rows[0] : (rows as any).rows?.[0];
    if (!r) return null;
    return rowToPrefs(r);
  } catch {
    return null;
  }
}

export async function upsertGuardianPreferences(
  guardianUserId: string,
  orgId: string,
  prefs: Partial<Omit<GuardianPreferences, "id" | "guardianUserId" | "orgId">>
): Promise<GuardianPreferences | null> {
  await ensureGuardianPrefsTable();
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO guardian_communication_preferences
        (guardian_user_id, org_id, email_enabled, sms_enabled, marketing_enabled,
         evaluation_reminders, schedule_notifications, program_updates,
         preferred_contact_method, pail_context, updated_at)
      VALUES (
        ${guardianUserId}, ${orgId},
        ${prefs.emailEnabled ?? true},
        ${prefs.smsEnabled ?? false},
        ${prefs.marketingEnabled ?? false},
        ${prefs.evaluationReminders ?? true},
        ${prefs.scheduleNotifications ?? true},
        ${prefs.programUpdates ?? true},
        ${prefs.preferredContactMethod ?? "email"},
        ${prefs.pailContext ?? null},
        now()
      )
      ON CONFLICT (guardian_user_id, org_id) DO UPDATE SET
        email_enabled              = EXCLUDED.email_enabled,
        sms_enabled                = EXCLUDED.sms_enabled,
        marketing_enabled          = EXCLUDED.marketing_enabled,
        evaluation_reminders       = EXCLUDED.evaluation_reminders,
        schedule_notifications     = EXCLUDED.schedule_notifications,
        program_updates            = EXCLUDED.program_updates,
        preferred_contact_method   = EXCLUDED.preferred_contact_method,
        pail_context               = COALESCE(EXCLUDED.pail_context, guardian_communication_preferences.pail_context),
        updated_at                 = now()
    `);
    return await getGuardianPreferences(guardianUserId, orgId);
  } catch (err: any) {
    console.warn("[GuardianAdmin] upsertGuardianPreferences:", err.message);
    return null;
  }
}

function rowToPrefs(r: any): GuardianPreferences {
  return {
    id: r.id,
    guardianUserId: r.guardian_user_id,
    orgId: r.org_id,
    emailEnabled: r.email_enabled ?? true,
    smsEnabled: r.sms_enabled ?? false,
    marketingEnabled: r.marketing_enabled ?? false,
    evaluationReminders: r.evaluation_reminders ?? true,
    scheduleNotifications: r.schedule_notifications ?? true,
    programUpdates: r.program_updates ?? true,
    preferredContactMethod: r.preferred_contact_method ?? "email",
    pailContext: r.pail_context ?? null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

// ─── Communication timeline ───────────────────────────────────────────────────

export async function buildCommunicationTimeline(
  orgId: string,
  guardianUserId: string,
  inviteEmail: string
): Promise<GuardianTimelineEvent[]> {
  const events: GuardianTimelineEvent[] = [];

  try {
    const { db } = await import("../db");
    const {
      athleteGuardianLinks,
      guardianNotifications,
      gmailAgentActions,
    } = await import("@shared/schema");
    const { eq, and, desc } = await import("drizzle-orm");

    // 1 — Guardian link events (invitation sent, accepted)
    try {
      const links = await db.select().from(athleteGuardianLinks)
        .where(and(
          eq(athleteGuardianLinks.orgId, orgId),
          eq(athleteGuardianLinks.guardianUserId, guardianUserId),
        ));
      for (const link of links) {
        if (link.createdAt) {
          events.push({
            id: `invite-sent-${link.id}`,
            type: "invitation_sent",
            title: "Guardian Invite Sent",
            description: `Invitation sent to ${link.inviteEmail ?? inviteEmail}`,
            date: link.createdAt.toISOString(),
            athleteUserId: link.athleteUserId,
          });
        }
        if (link.activatedAt && link.status === "active") {
          events.push({
            id: `invite-accepted-${link.id}`,
            type: "invitation_accepted",
            title: "Guardian Accepted Invite",
            description: "Guardian created their account and accepted the invitation",
            date: link.activatedAt.toISOString(),
            athleteUserId: link.athleteUserId,
          });
        } else if (!link.activatedAt && link.status === "pending") {
          events.push({
            id: `invite-pending-${link.id}`,
            type: "invitation_pending",
            title: "Invite Awaiting Acceptance",
            description: `Guardian invite is pending — ${link.inviteEmail ?? inviteEmail} has not accepted yet`,
            date: link.createdAt?.toISOString() ?? new Date().toISOString(),
            athleteUserId: link.athleteUserId,
          });
        }
      }
    } catch {}

    // 2 — Guardian notifications (coach messages, system events)
    try {
      const notifs = await db.select().from(guardianNotifications)
        .where(and(
          eq(guardianNotifications.orgId, orgId),
          eq(guardianNotifications.guardianUserId, guardianUserId),
        ))
        .orderBy(desc(guardianNotifications.createdAt))
        .limit(50);
      for (const n of notifs) {
        events.push({
          id: `notif-${n.id}`,
          type: "notification_sent",
          title: n.title || "Notification Sent",
          description: n.message || "",
          date: n.createdAt?.toISOString() ?? new Date().toISOString(),
          athleteUserId: n.athleteUserId,
          metadata: (n.metadata as any) ?? {},
        });
      }
    } catch {}

    // 3 — AgentMail drafts/sends addressed to this guardian's email
    try {
      const actions = await db.select({
        id: gmailAgentActions.id,
        actionType: gmailAgentActions.actionType,
        subject: gmailAgentActions.subject,
        status: gmailAgentActions.status,
        createdAt: gmailAgentActions.createdAt,
        executedAt: gmailAgentActions.executedAt,
        communicationDomain: gmailAgentActions.communicationDomain,
      })
      .from(gmailAgentActions)
      .where(and(
        eq(gmailAgentActions.orgId, orgId),
        eq(gmailAgentActions.recipientEmail, inviteEmail),
      ))
      .orderBy(desc(gmailAgentActions.createdAt))
      .limit(30);

      for (const a of actions) {
        const isApproved = a.status === "approved" || a.status === "sent" || a.status === "executed";
        events.push({
          id: `agent-${a.id}`,
          type: isApproved ? "welcome_draft_approved" : "welcome_draft_queued",
          title: isApproved ? "Email Approved & Sent" : "Email Draft Queued",
          description: a.subject ? `"${a.subject}"` : `Agent action: ${a.actionType}`,
          date: (isApproved && a.executedAt ? a.executedAt : a.createdAt)?.toISOString() ?? new Date().toISOString(),
          metadata: { actionType: a.actionType, status: a.status, domain: a.communicationDomain },
        });
      }
    } catch {}

  } catch (err: any) {
    console.warn("[GuardianAdmin] buildCommunicationTimeline:", err.message);
  }

  // Sort newest first
  return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// ─── Guardian list ─────────────────────────────────────────────────────────────

export async function getGuardiansForOrg(
  orgId: string,
  filters: { status?: string; search?: string; inviteStatus?: string } = {}
): Promise<{ guardians: GuardianRecord[]; metrics: GuardianMetrics }> {
  await ensureGuardianPrefsTable();

  try {
    const { db } = await import("../db");
    const {
      athleteGuardianLinks,
      guardianNotifications,
    } = await import("@shared/schema");
    const { userProfiles } = await import("@shared/schema");
    const { users: usersTable } = await import("@shared/models/auth");
    const { eq, and, desc, sql } = await import("drizzle-orm");

    // Fetch all links for org
    const allLinks = await db.select().from(athleteGuardianLinks)
      .where(eq(athleteGuardianLinks.orgId, orgId))
      .orderBy(desc(athleteGuardianLinks.createdAt));

    if (allLinks.length === 0) {
      return {
        guardians: [],
        metrics: { totalGuardians: 0, pendingInvites: 0, activeGuardians: 0, neverContacted: 0, incompletePreferences: 0, familiesMultipleAthletes: 0, acceptanceRate: 0 },
      };
    }

    // Collect unique guardian keys (real userId or inviteEmail for pending)
    // Group by guardianUserId if real, else by inviteEmail
    const byGuardian = new Map<string, typeof allLinks>();
    for (const link of allLinks) {
      const key = link.guardianUserId?.startsWith("pending-")
        ? `email:${link.inviteEmail ?? link.guardianUserId}`
        : link.guardianUserId;
      if (!byGuardian.has(key)) byGuardian.set(key, []);
      byGuardian.get(key)!.push(link);
    }

    // Load user profiles for real guardians
    const realGuardianIds = [...byGuardian.keys()]
      .filter(k => !k.startsWith("email:") && k)
      .slice(0, 200);

    const guardianProfiles = realGuardianIds.length > 0
      ? await db.select().from(userProfiles)
          .where(sql`${userProfiles.userId} = ANY(ARRAY[${sql.join(realGuardianIds.map(id => sql`${id}`), sql`, `)}]::text[])`)
      : [];

    // Load user auth info (email, phone, lastSignInAt)
    const authRows = realGuardianIds.length > 0
      ? await db.select({
          id: usersTable.id,
          email: usersTable.email,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
          phone: usersTable.phone,
          lastSignInAt: usersTable.lastSignInAt,
        })
        .from(usersTable)
        .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(realGuardianIds.map(id => sql`${id}`), sql`, `)}]::text[])`)
      : [];

    const profileMap = Object.fromEntries(guardianProfiles.map((p: any) => [p.userId, p]));
    const authMap = Object.fromEntries(authRows.map((u: any) => [u.id, u]));

    // Load athlete user profiles
    const allAthleteIds = [...new Set(allLinks.map(l => l.athleteUserId))].slice(0, 200);
    const athleteProfiles = allAthleteIds.length > 0
      ? await db.select().from(userProfiles)
          .where(sql`${userProfiles.userId} = ANY(ARRAY[${sql.join(allAthleteIds.map(id => sql`${id}`), sql`, `)}]::text[])`)
      : [];
    const athleteMap = Object.fromEntries(athleteProfiles.map((p: any) => [p.userId, p]));

    // Last notification per guardian
    const notifRows = await db.select({
      guardianUserId: guardianNotifications.guardianUserId,
      latestAt: sql<string>`max(${guardianNotifications.createdAt})`,
    })
    .from(guardianNotifications)
    .where(eq(guardianNotifications.orgId, orgId))
    .groupBy(guardianNotifications.guardianUserId);
    const lastNotifMap = Object.fromEntries(notifRows.map((n: any) => [n.guardianUserId, n.latestAt]));

    // Load preferences for real guardians
    let prefsMap: Record<string, GuardianPreferences> = {};
    try {
      const rawPrefs = await db.execute(sql`
        SELECT * FROM guardian_communication_preferences WHERE org_id = ${orgId}
      `);
      const prefsRows = Array.isArray(rawPrefs) ? rawPrefs : (rawPrefs as any).rows ?? [];
      prefsMap = Object.fromEntries(prefsRows.map((r: any) => [r.guardian_user_id, rowToPrefs(r)]));
    } catch {}

    // Build guardian records
    const guardians: GuardianRecord[] = [];

    for (const [key, links] of byGuardian.entries()) {
      const isPending = key.startsWith("email:");
      const guardianUserId = isPending ? key : key;
      const firstLink = links[0];
      const inviteEmail = firstLink.inviteEmail ?? "";
      const status = firstLink.status as string;

      const authInfo = !isPending ? authMap[guardianUserId] : null;
      const profileInfo = !isPending ? profileMap[guardianUserId] : null;

      const email = authInfo?.email ?? inviteEmail;
      const firstName = authInfo?.firstName ?? profileInfo?.firstName ?? null;
      const lastName = authInfo?.lastName ?? profileInfo?.lastName ?? null;
      const phone = authInfo?.phone ?? null;
      const lastSignInAt = authInfo?.lastSignInAt ? new Date(authInfo.lastSignInAt).toISOString() : null;

      // Apply filters
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const matchEmail = email.toLowerCase().includes(q);
        const matchName = `${firstName ?? ""} ${lastName ?? ""}`.toLowerCase().includes(q);
        if (!matchEmail && !matchName) continue;
      }
      if (filters.status && status !== filters.status) continue;
      if (filters.inviteStatus) {
        if (filters.inviteStatus === "pending" && status !== "pending") continue;
        if (filters.inviteStatus === "active" && status !== "active") continue;
        if (filters.inviteStatus === "no_invite" && status !== "no_invite") continue;
      }

      const inviteStatus = isPending
        ? "pending"
        : (status === "active" ? "active" : status === "pending" ? "pending" : status === "revoked" ? "revoked" : "active") as GuardianRecord["inviteStatus"];

      const linkedAthletes = links.map(l => {
        const ap = athleteMap[l.athleteUserId];
        const athleteName = ap
          ? `${ap.firstName ?? ""} ${ap.lastName ?? ""}`.trim() || ap.username || "Athlete"
          : "Unknown Athlete";
        return {
          athleteUserId: l.athleteUserId,
          athleteName,
          status: l.status,
          createdAt: l.createdAt?.toISOString() ?? null,
          activatedAt: l.activatedAt?.toISOString() ?? null,
          linkId: l.id,
        };
      });

      const lastCommunicationAt = lastNotifMap[guardianUserId] ?? null;
      const prefs = prefsMap[guardianUserId] ?? null;

      // Compute guardian alerts
      const alerts = computeGuardianAlerts({
        guardianUserId,
        email,
        links,
        lastCommunicationAt,
        prefs,
      });

      guardians.push({
        guardianUserId,
        email,
        firstName,
        lastName,
        phone,
        lastSignInAt,
        inviteStatus,
        athleteCount: links.length,
        linkedAthletes,
        lastCommunicationAt: lastCommunicationAt ? new Date(lastCommunicationAt).toISOString() : null,
        alertCount: alerts.length,
        alerts,
        preferences: prefs,
      });
    }

    // Compute metrics
    const totalGuardians = guardians.length;
    const pendingInvites = guardians.filter(g => g.inviteStatus === "pending").length;
    const activeGuardians = guardians.filter(g => g.inviteStatus === "active").length;
    const neverContacted = guardians.filter(g => !g.lastCommunicationAt).length;
    const incompletePreferences = guardians.filter(g => !g.preferences).length;
    const familiesMultipleAthletes = guardians.filter(g => g.athleteCount > 1).length;
    const sentInvites = pendingInvites + activeGuardians;
    const acceptanceRate = sentInvites > 0 ? Math.round((activeGuardians / sentInvites) * 100) : 0;

    return {
      guardians,
      metrics: { totalGuardians, pendingInvites, activeGuardians, neverContacted, incompletePreferences, familiesMultipleAthletes, acceptanceRate },
    };
  } catch (err: any) {
    console.warn("[GuardianAdmin] getGuardiansForOrg error:", err.message);
    return {
      guardians: [],
      metrics: { totalGuardians: 0, pendingInvites: 0, activeGuardians: 0, neverContacted: 0, incompletePreferences: 0, familiesMultipleAthletes: 0, acceptanceRate: 0 },
    };
  }
}

// ─── Guardian detail ──────────────────────────────────────────────────────────

export async function getGuardianDetail(orgId: string, guardianUserId: string): Promise<any> {
  await ensureGuardianPrefsTable();
  try {
    const { db } = await import("../db");
    const { athleteGuardianLinks, guardianNotifications, athleteOnboardingChecklists } = await import("@shared/schema");
    const { userProfiles } = await import("@shared/schema");
    const { users: usersTable } = await import("@shared/models/auth");
    const { eq, and, sql, desc } = await import("drizzle-orm");

    // Links for this guardian
    const links = await db.select().from(athleteGuardianLinks)
      .where(and(
        eq(athleteGuardianLinks.orgId, orgId),
        eq(athleteGuardianLinks.guardianUserId, guardianUserId),
      ));

    if (links.length === 0) return null;

    const inviteEmail = links[0].inviteEmail ?? "";
    const isPendingUser = guardianUserId.startsWith("pending-");

    // Guardian user info
    let guardianUser: any = null;
    if (!isPendingUser) {
      const [authRow] = await db.select({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        phone: usersTable.phone,
        lastSignInAt: usersTable.lastSignInAt,
        createdAt: usersTable.createdAt,
        notificationPreferences: usersTable.notificationPreferences,
      })
      .from(usersTable)
      .where(eq(usersTable.id, guardianUserId))
      .limit(1);
      guardianUser = authRow ?? null;
    }

    // Athlete profiles for linked athletes
    const athleteIds = links.map(l => l.athleteUserId);
    const athleteProfiles = athleteIds.length > 0
      ? await db.select().from(userProfiles)
          .where(sql`${userProfiles.userId} = ANY(ARRAY[${sql.join(athleteIds.map(id => sql`${id}`), sql`, `)}]::text[])`)
      : [];
    const apMap = Object.fromEntries(athleteProfiles.map((p: any) => [p.userId, p]));

    // Onboarding checklists for linked athletes
    const onboardingRows = athleteIds.length > 0
      ? await db.select().from(athleteOnboardingChecklists)
          .where(and(
            eq(athleteOnboardingChecklists.orgId, orgId),
            sql`${athleteOnboardingChecklists.athleteUserId} = ANY(ARRAY[${sql.join(athleteIds.map(id => sql`${id}`), sql`, `)}]::text[])`,
          ))
      : [];
    const onboardingMap = Object.fromEntries(onboardingRows.map((r: any) => [r.athleteUserId, r]));

    // Recent notifications
    const recentNotifs = await db.select().from(guardianNotifications)
      .where(and(
        eq(guardianNotifications.orgId, orgId),
        eq(guardianNotifications.guardianUserId, guardianUserId),
      ))
      .orderBy(desc(guardianNotifications.createdAt))
      .limit(20);

    // Communication timeline
    const timeline = await buildCommunicationTimeline(orgId, guardianUserId, inviteEmail);

    // Preferences
    const prefs = await getGuardianPreferences(guardianUserId, orgId);

    // Guardian alerts
    const lastComm = recentNotifs[0]?.createdAt;
    const alerts = computeGuardianAlerts({ guardianUserId, email: guardianUser?.email ?? inviteEmail, links, lastCommunicationAt: lastComm?.toISOString() ?? null, prefs });

    const linkedAthletes = links.map(l => {
      const ap = apMap[l.athleteUserId];
      const onboarding = onboardingMap[l.athleteUserId];
      const athleteName = ap
        ? `${ap.firstName ?? ""} ${ap.lastName ?? ""}`.trim() || ap.username || "Athlete"
        : "Unknown Athlete";
      return {
        athleteUserId: l.athleteUserId,
        athleteName,
        linkId: l.id,
        linkStatus: l.status,
        createdAt: l.createdAt?.toISOString() ?? null,
        activatedAt: l.activatedAt?.toISOString() ?? null,
        onboarding: onboarding ? {
          id: onboarding.id,
          status: onboarding.status,
          programAssigned: onboarding.programAssigned,
          firstSessionScheduled: onboarding.firstSessionScheduled,
          firstSessionCompleted: onboarding.firstSessionCompleted,
          accountInviteSent: onboarding.accountInviteSent,
        } : null,
      };
    });

    return {
      guardianUserId,
      inviteEmail,
      inviteStatus: links[0].status,
      email: guardianUser?.email ?? inviteEmail,
      firstName: guardianUser?.firstName ?? null,
      lastName: guardianUser?.lastName ?? null,
      phone: guardianUser?.phone ?? null,
      lastSignInAt: guardianUser?.lastSignInAt ? new Date(guardianUser.lastSignInAt).toISOString() : null,
      memberSince: guardianUser?.createdAt ? new Date(guardianUser.createdAt).toISOString() : null,
      linkedAthletes,
      timeline,
      preferences: prefs,
      alerts,
      alertCount: alerts.length,
      recentNotifications: recentNotifs.map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        isRead: n.isRead,
        createdAt: n.createdAt?.toISOString() ?? null,
      })),
    };
  } catch (err: any) {
    console.warn("[GuardianAdmin] getGuardianDetail error:", err.message);
    return null;
  }
}

// ─── Guardian alert computation ───────────────────────────────────────────────

function computeGuardianAlerts({
  guardianUserId,
  email,
  links,
  lastCommunicationAt,
  prefs,
}: {
  guardianUserId: string;
  email: string;
  links: any[];
  lastCommunicationAt: string | null;
  prefs: GuardianPreferences | null;
}): GuardianAlert[] {
  const alerts: GuardianAlert[] = [];
  const now = Date.now();

  for (const link of links) {
    const linkAgeHours = link.createdAt
      ? (now - new Date(link.createdAt).getTime()) / 3600000
      : 0;

    // Invite never accepted after 48h
    if (link.status === "pending" && linkAgeHours >= 48) {
      const severity: GuardianAlert["severity"] = linkAgeHours >= 168 ? "high" : "medium";
      alerts.push({
        key: `guardian:invite_pending:${link.id}`,
        type: "invite_pending",
        severity,
        title: "Guardian invite not accepted",
        message: `Guardian invite to ${email} has been pending for ${Math.round(linkAgeHours / 24)} day${Math.round(linkAgeHours / 24) !== 1 ? "s" : ""}.`,
        guardianEmail: email,
        athleteUserId: link.athleteUserId,
        linkId: link.id,
        ageHours: Math.round(linkAgeHours),
        actionLabel: "Resend Invite",
        actionUrl: "/admin/guardians",
      });
    }

    // Invite stalled > 7 days — escalate
    if (link.status === "pending" && linkAgeHours >= 168) {
      alerts.push({
        key: `guardian:invite_stalled:${link.id}`,
        type: "invite_stalled",
        severity: "high",
        title: "Guardian invite stalled",
        message: `Guardian invite has been pending for over 7 days — consider following up directly.`,
        guardianEmail: email,
        athleteUserId: link.athleteUserId,
        linkId: link.id,
        ageHours: Math.round(linkAgeHours),
        actionLabel: "Follow Up",
        actionUrl: "/admin/guardians",
      });
    }
  }

  // No communication ever
  if (!lastCommunicationAt && links.some(l => l.status === "active")) {
    alerts.push({
      key: `guardian:never_contacted:${guardianUserId}`,
      type: "never_contacted",
      severity: "low",
      title: "Guardian never contacted",
      message: `No communication has been sent to this guardian yet.`,
      guardianEmail: email,
      athleteUserId: links[0]?.athleteUserId ?? "",
      linkId: links[0]?.id ?? "",
      ageHours: 0,
      actionLabel: "Queue Welcome Draft",
      actionUrl: "/admin/guardians",
    });
  }

  // Preferences not configured
  if (!prefs && links.some(l => l.status === "active")) {
    alerts.push({
      key: `guardian:prefs_incomplete:${guardianUserId}`,
      type: "prefs_incomplete",
      severity: "low",
      title: "Communication preferences not set",
      message: "Guardian communication preferences have not been configured yet.",
      guardianEmail: email,
      athleteUserId: links[0]?.athleteUserId ?? "",
      linkId: links[0]?.id ?? "",
      ageHours: 0,
      actionLabel: "Set Preferences",
      actionUrl: "/admin/guardians",
    });
  }

  return alerts;
}

// ─── Queue guardian welcome draft ─────────────────────────────────────────────

export async function queueGuardianWelcomeDraft(
  orgId: string,
  guardianUserId: string,
  athleteUserId: string,
  inviteEmail: string,
  athleteName: string,
  orgName: string
): Promise<{ ok: boolean; actionId?: string; message: string }> {
  try {
    const { db } = await import("../db");
    const { gmailAgentActions } = await import("@shared/schema");
    const { eq, and, sql } = await import("drizzle-orm");

    // Check for existing pending welcome draft for this guardian
    const existing = await db.select({ id: gmailAgentActions.id, status: gmailAgentActions.status })
      .from(gmailAgentActions)
      .where(and(
        eq(gmailAgentActions.orgId, orgId),
        eq(gmailAgentActions.recipientEmail, inviteEmail),
        sql`${gmailAgentActions.actionType} LIKE 'propose_draft:guardian_welcome%'`,
        sql`${gmailAgentActions.status} IN ('proposed', 'pending', 'approved')`,
      ))
      .limit(1);

    if (existing.length > 0) {
      return { ok: false, actionId: existing[0].id, message: "A guardian welcome draft is already queued for this guardian." };
    }

    const subject = `Welcome to ${orgName} — ${athleteName}'s Training Journey Begins`;
    const bodyPreview = `Dear Parent/Guardian,\n\nWe're thrilled to welcome ${athleteName} to ${orgName}. Your support plays a vital role in their athletic development. Here's what to expect during the onboarding process...`;

    const [action] = await db.insert(gmailAgentActions).values({
      orgId,
      actionType: "propose_draft:guardian_welcome",
      recipientEmail: inviteEmail,
      subject,
      bodyPreview,
      riskLevel: "low",
      approvalRequired: true,
      status: "proposed",
      createdByAgent: "Guardian Onboarding Agent",
      communicationDomain: "guardian_onboarding",
    } as any).returning({ id: gmailAgentActions.id });

    return { ok: true, actionId: action.id, message: "Guardian welcome draft queued in AI Approvals." };
  } catch (err: any) {
    console.warn("[GuardianAdmin] queueGuardianWelcomeDraft:", err.message);
    return { ok: false, message: `Failed to queue draft: ${err.message}` };
  }
}

// ─── CEO Heartbeat metrics ────────────────────────────────────────────────────

export async function computeGuardianMetricsForOrg(orgId: string): Promise<GuardianMetrics> {
  try {
    const { db } = await import("../db");
    const { athleteGuardianLinks, guardianNotifications } = await import("@shared/schema");
    const { eq, and, sql, desc } = await import("drizzle-orm");

    const allLinks = await db.select({
      guardianUserId: athleteGuardianLinks.guardianUserId,
      status: athleteGuardianLinks.status,
      createdAt: athleteGuardianLinks.createdAt,
    })
    .from(athleteGuardianLinks)
    .where(eq(athleteGuardianLinks.orgId, orgId));

    const uniqueGuardians = new Set<string>();
    const pendingLinks = new Set<string>();
    const activeGuardians = new Set<string>();
    const multiAthleteGuardians = new Map<string, number>();

    for (const l of allLinks) {
      const key = l.guardianUserId ?? "";
      uniqueGuardians.add(key);
      if (l.status === "pending") pendingLinks.add(key);
      if (l.status === "active") activeGuardians.add(key);
      multiAthleteGuardians.set(key, (multiAthleteGuardians.get(key) ?? 0) + 1);
    }

    // Guardians with at least one notification
    const contactedGuardians = new Set<string>();
    try {
      const notifRows = await db.select({ guardianUserId: guardianNotifications.guardianUserId })
        .from(guardianNotifications)
        .where(eq(guardianNotifications.orgId, orgId));
      for (const r of notifRows) contactedGuardians.add(r.guardianUserId);
    } catch {}

    const totalGuardians = uniqueGuardians.size;
    const pendingInvites = pendingLinks.size;
    const active = activeGuardians.size;
    const neverContacted = [...activeGuardians].filter(id => !contactedGuardians.has(id)).length;
    const familiesMultipleAthletes = [...multiAthleteGuardians.values()].filter(c => c > 1).length;
    const sentInvites = pendingInvites + active;
    const acceptanceRate = sentInvites > 0 ? Math.round((active / sentInvites) * 100) : 0;

    // Preferences — check how many active guardians have preferences set
    let incompletePrefs = active; // assume none configured until proven
    try {
      await ensureGuardianPrefsTable();
      const { sql: sqlTag } = await import("drizzle-orm");
      const prefsCount = await db.execute(sqlTag`
        SELECT COUNT(DISTINCT guardian_user_id) as cnt
        FROM guardian_communication_preferences
        WHERE org_id = ${orgId}
      `);
      const rows = Array.isArray(prefsCount) ? prefsCount : (prefsCount as any).rows ?? [];
      const cnt = parseInt((rows[0] as any)?.cnt ?? "0", 10);
      incompletePrefs = Math.max(0, active - cnt);
    } catch {}

    return {
      totalGuardians,
      pendingInvites,
      activeGuardians: active,
      neverContacted,
      incompletePreferences: incompletePrefs,
      familiesMultipleAthletes,
      acceptanceRate,
    };
  } catch (err: any) {
    console.warn("[GuardianAdmin] computeGuardianMetricsForOrg error:", err.message);
    return { totalGuardians: 0, pendingInvites: 0, activeGuardians: 0, neverContacted: 0, incompletePreferences: 0, familiesMultipleAthletes: 0, acceptanceRate: 0 };
  }
}

// ─── Guardian alerts for CEO Heartbeat + attention engine ─────────────────────

export async function computeGuardianAlertsForOrg(orgId: string): Promise<GuardianAlert[]> {
  const { guardians } = await getGuardiansForOrg(orgId);
  return guardians.flatMap(g => g.alerts);
}
