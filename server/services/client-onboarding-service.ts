import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureOnboardingStatesTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_onboarding_states (
      id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         VARCHAR NOT NULL UNIQUE,
      first_viewed_at TIMESTAMP,
      profile_confirmed_at TIMESTAMP,
      onboarding_completed_at TIMESTAMP,
      created_at      TIMESTAMP DEFAULT NOW()
    )
  `);
}

function toUserFacingState(state: string): {
  label: string;
  description: string;
  done: boolean;
  actionNeeded: boolean;
  urgency: "high" | "medium" | "low" | "none";
} {
  switch (state) {
    case "actively_training":
      return { label: "Actively Training", description: "You're actively training — keep it up!", done: true, actionNeeded: false, urgency: "none" };
    case "ready_to_train":
      return { label: "Ready to Train", description: "You're ready for your first training session!", done: true, actionNeeded: false, urgency: "none" };
    case "needs_waiver":
      return { label: "Form Required", description: "A required form needs to be completed before training begins.", done: false, actionNeeded: true, urgency: "high" };
    case "needs_billing":
      return { label: "Payment Setup Needed", description: "Payment setup is needed before training starts.", done: false, actionNeeded: true, urgency: "high" };
    case "needs_first_session":
      return { label: "Session Not Yet Scheduled", description: "Your first session still needs to be scheduled.", done: false, actionNeeded: false, urgency: "medium" };
    case "needs_program":
      return { label: "Plan Being Prepared", description: "Your coach is preparing your personalized training plan.", done: false, actionNeeded: false, urgency: "low" };
    case "needs_onboarding":
    default:
      return { label: "Account Being Set Up", description: "Your account is being set up — we'll be in touch shortly.", done: false, actionNeeded: false, urgency: "low" };
  }
}

function computeReadinessState(checklist: Record<string, boolean>): string {
  if (checklist.firstSessionCompleted) return "actively_training";
  if (!checklist.accountInviteSent) return "needs_onboarding";
  if (!checklist.programAssigned) return "needs_program";
  if (!checklist.firstSessionScheduled) return "needs_first_session";
  if (!checklist.paymentSetup) return "needs_billing";
  if (checklist.waiverCompleted === false) return "needs_waiver";
  return "ready_to_train";
}

function buildChecklistItems(checklist: Record<string, boolean>, readinessState: string) {
  const items = [
    {
      key: "account",
      label: "Account created",
      description: "Your account has been set up",
      done: checklist.accountInviteSent ?? false,
    },
    {
      key: "welcome",
      label: "Welcome message",
      description: "You received a welcome message from your coach",
      done: checklist.welcomeDraftApproved ?? false,
    },
    {
      key: "program",
      label: "Training plan assigned",
      description: checklist.programAssigned
        ? "Your coach has assigned a training plan"
        : "Your coach is preparing your training plan",
      done: checklist.programAssigned ?? false,
    },
    {
      key: "session",
      label: "First session scheduled",
      description: checklist.firstSessionScheduled
        ? "Your first training session has been scheduled"
        : "Your first session still needs to be scheduled",
      done: checklist.firstSessionScheduled ?? false,
    },
    {
      key: "payment",
      label: "Payment setup",
      description: checklist.paymentSetup
        ? "Payment is all set"
        : "Payment setup is needed before training starts",
      done: checklist.paymentSetup ?? false,
      actionNeeded: !checklist.paymentSetup && readinessState === "needs_billing",
    },
    {
      key: "completed",
      label: "First session completed",
      description: checklist.firstSessionCompleted
        ? "You've completed your first session — great work!"
        : "Complete your first training session",
      done: checklist.firstSessionCompleted ?? false,
    },
  ];
  return items;
}

function buildMissingItems(checklist: Record<string, boolean>, readinessState: string): string[] {
  const missing: string[] = [];
  if (!checklist.programAssigned) missing.push("Your training plan is being prepared by your coach.");
  if (!checklist.firstSessionScheduled) missing.push("Your first session needs to be scheduled.");
  if (!checklist.paymentSetup && readinessState === "needs_billing") missing.push("Payment setup is required before training starts.");
  if (checklist.waiverCompleted === false && readinessState === "needs_waiver") missing.push("A required form needs to be completed.");
  return missing;
}

export async function getOnboardingType(userId: string): Promise<{ isFirstLogin: boolean; redirectTo: string }> {
  const stateRows = await db.execute(sql`
    SELECT first_viewed_at FROM user_onboarding_states WHERE user_id = ${userId} LIMIT 1
  `);
  const stateRow: any = Array.isArray(stateRows) ? stateRows[0] : (stateRows as any).rows?.[0];
  const isFirstLogin = !stateRow?.first_viewed_at;

  const guardianRows = await db.execute(sql`
    SELECT 1 FROM athlete_guardian_links
    WHERE guardian_user_id = ${userId} AND status IN ('active','pending')
    LIMIT 1
  `);
  const isGuardian = Array.isArray(guardianRows)
    ? guardianRows.length > 0
    : ((guardianRows as any).rows?.length ?? 0) > 0;

  return {
    isFirstLogin,
    redirectTo: isGuardian ? "/guardian/onboarding" : "/client/onboarding",
  };
}

export async function getAthleteOnboardingSummary(userId: string) {
  const userRows = await db.execute(sql`
    SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.profile_image_url,
           u.sms_opt_in, u.notification_preferences, u.created_at,
           up.organization_id AS org_id, up.role
    FROM users u
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE u.id = ${userId}
    LIMIT 1
  `);
  const userRow: any = Array.isArray(userRows) ? userRows[0] : (userRows as any).rows?.[0];
  if (!userRow) return null;

  const orgId: string | null = userRow.org_id ?? null;

  const orgRows = orgId
    ? await db.execute(sql`
        SELECT id, name, slug, logo_url, tagline, owner_email, scheduling_inquiry_email, scheduling_inquiry_name
        FROM organizations WHERE id = ${orgId} LIMIT 1
      `)
    : [];
  const orgRow: any = Array.isArray(orgRows) ? orgRows[0] : (orgRows as any).rows?.[0];

  const checklistRows = orgId
    ? await db.execute(sql`
        SELECT * FROM athlete_onboarding_checklists
        WHERE athlete_user_id = ${userId} AND org_id = ${orgId}
        ORDER BY created_at DESC LIMIT 1
      `)
    : [];
  const checklist: any = Array.isArray(checklistRows)
    ? checklistRows[0]
    : (checklistRows as any).rows?.[0];

  const checklistMap: Record<string, boolean> = checklist
    ? {
        accountInviteSent: !!checklist.account_invite_sent,
        welcomeDraftApproved: !!checklist.welcome_draft_approved,
        programAssigned: !!checklist.program_assigned,
        firstSessionScheduled: !!checklist.first_session_scheduled,
        paymentSetup: !!checklist.payment_setup,
        waiverCompleted: !!checklist.waiver_completed,
        firstSessionCompleted: !!checklist.first_session_completed,
      }
    : { accountInviteSent: true };

  const readinessState = computeReadinessState(checklistMap);
  const readiness = toUserFacingState(readinessState);
  const checklistItems = buildChecklistItems(checklistMap, readinessState);
  const missingItems = buildMissingItems(checklistMap, readinessState);

  const nextSessionRows = orgId
    ? await db.execute(sql`
        SELECT b.id, b.start_at, b.end_at, b.location, b.status,
               s.name AS service_name, s.session_type, s.duration_min,
               u.first_name AS coach_first_name, u.last_name AS coach_last_name
        FROM bookings b
        LEFT JOIN services s ON s.id = b.service_id
        LEFT JOIN users u ON u.id = b.coach_id
        WHERE b.client_id = ${userId}
          AND b.organization_id = ${orgId}
          AND b.status NOT IN ('CANCELLED','RESCHEDULED')
          AND b.start_at > NOW()
        ORDER BY b.start_at ASC LIMIT 1
      `)
    : [];
  const nextSession: any = Array.isArray(nextSessionRows)
    ? nextSessionRows[0]
    : (nextSessionRows as any).rows?.[0];

  const stateRows = await db.execute(sql`
    SELECT * FROM user_onboarding_states WHERE user_id = ${userId} LIMIT 1
  `);
  const stateRow: any = Array.isArray(stateRows)
    ? stateRows[0]
    : (stateRows as any).rows?.[0];

  const completedCount = checklistItems.filter((i) => i.done).length;
  const totalCount = checklistItems.length;

  const nextBestAction = checklist?.next_best_action ?? null;

  const contactOptions: { label: string; type: string; value: string }[] = [];
  if (orgRow?.scheduling_inquiry_email) {
    contactOptions.push({ label: "Email Coach", type: "email", value: orgRow.scheduling_inquiry_email });
  } else if (orgRow?.owner_email) {
    contactOptions.push({ label: "Email Organization", type: "email", value: orgRow.owner_email });
  }

  return {
    userType: "athlete" as const,
    isFirstLogin: !stateRow?.first_viewed_at,
    profileConfirmed: !!stateRow?.profile_confirmed_at,
    user: {
      id: userRow.id,
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      email: userRow.email,
      phone: userRow.phone,
      profileImageUrl: userRow.profile_image_url,
      smsOptIn: userRow.sms_opt_in,
      notificationPreferences: userRow.notification_preferences,
    },
    organization: orgRow
      ? {
          id: orgRow.id,
          name: orgRow.name,
          slug: orgRow.slug,
          logoUrl: orgRow.logo_url,
          tagline: orgRow.tagline,
        }
      : null,
    readiness: {
      state: readinessState,
      ...readiness,
    },
    checklistItems,
    missingItems,
    nextBestAction,
    progress: { completed: completedCount, total: totalCount, pct: Math.round((completedCount / totalCount) * 100) },
    nextSession: nextSession
      ? {
          id: nextSession.id,
          startAt: nextSession.start_at,
          endAt: nextSession.end_at,
          location: nextSession.location,
          serviceName: nextSession.service_name,
          sessionType: nextSession.session_type,
          durationMin: nextSession.duration_min,
          coachName: [nextSession.coach_first_name, nextSession.coach_last_name].filter(Boolean).join(" ") || null,
        }
      : null,
    contactOptions,
  };
}

export async function getGuardianOnboardingSummary(userId: string) {
  const userRows = await db.execute(sql`
    SELECT u.id, u.email, u.first_name, u.last_name, u.phone,
           u.sms_opt_in, u.notification_preferences
    FROM users u WHERE u.id = ${userId} LIMIT 1
  `);
  const userRow: any = Array.isArray(userRows) ? userRows[0] : (userRows as any).rows?.[0];
  if (!userRow) return null;

  const linkRows = await db.execute(sql`
    SELECT agl.athlete_user_id, agl.org_id, agl.status, agl.permissions,
           u.first_name AS athlete_first, u.last_name AS athlete_last,
           u.email AS athlete_email, u.profile_image_url AS athlete_avatar
    FROM athlete_guardian_links agl
    JOIN users u ON u.id = agl.athlete_user_id
    WHERE agl.guardian_user_id = ${userId}
      AND agl.status IN ('active','pending')
  `);
  const links: any[] = Array.isArray(linkRows) ? linkRows : (linkRows as any).rows ?? [];

  const linkedAthletes = await Promise.all(
    links.map(async (link) => {
      const athleteId = link.athlete_user_id;
      const orgId = link.org_id;

      const checklistRows = await db.execute(sql`
        SELECT * FROM athlete_onboarding_checklists
        WHERE athlete_user_id = ${athleteId} AND org_id = ${orgId}
        ORDER BY created_at DESC LIMIT 1
      `);
      const checklist: any = Array.isArray(checklistRows)
        ? checklistRows[0]
        : (checklistRows as any).rows?.[0];

      const checklistMap: Record<string, boolean> = checklist
        ? {
            accountInviteSent: !!checklist.account_invite_sent,
            welcomeDraftApproved: !!checklist.welcome_draft_approved,
            programAssigned: !!checklist.program_assigned,
            firstSessionScheduled: !!checklist.first_session_scheduled,
            paymentSetup: !!checklist.payment_setup,
            waiverCompleted: !!checklist.waiver_completed,
            firstSessionCompleted: !!checklist.first_session_completed,
          }
        : { accountInviteSent: true };

      const readinessState = computeReadinessState(checklistMap);
      const readiness = toUserFacingState(readinessState);
      const missingItems = buildMissingItems(checklistMap, readinessState);

      const nextSessionRows = await db.execute(sql`
        SELECT b.start_at, b.end_at, b.location, s.name AS service_name
        FROM bookings b
        LEFT JOIN services s ON s.id = b.service_id
        WHERE b.client_id = ${athleteId}
          AND b.organization_id = ${orgId}
          AND b.status NOT IN ('CANCELLED','RESCHEDULED')
          AND b.start_at > NOW()
        ORDER BY b.start_at ASC LIMIT 1
      `);
      const nextSession: any = Array.isArray(nextSessionRows)
        ? nextSessionRows[0]
        : (nextSessionRows as any).rows?.[0];

      const orgRows = await db.execute(sql`
        SELECT name, slug FROM organizations WHERE id = ${orgId} LIMIT 1
      `);
      const orgRow: any = Array.isArray(orgRows) ? orgRows[0] : (orgRows as any).rows?.[0];

      const completedCount = Object.values(checklistMap).filter(Boolean).length;
      const totalCount = Object.keys(checklistMap).length;

      return {
        athleteUserId: athleteId,
        athleteName: [link.athlete_first, link.athlete_last].filter(Boolean).join(" ") || link.athlete_email,
        athleteAvatar: link.athlete_avatar,
        linkStatus: link.status,
        organization: orgRow ? { name: orgRow.name, slug: orgRow.slug } : null,
        readiness: { state: readinessState, ...readiness },
        missingItems,
        nextSession: nextSession
          ? {
              startAt: nextSession.start_at,
              endAt: nextSession.end_at,
              location: nextSession.location,
              serviceName: nextSession.service_name,
            }
          : null,
        progress: { completed: completedCount, total: totalCount, pct: Math.round((completedCount / totalCount) * 100) },
      };
    })
  );

  const stateRows = await db.execute(sql`
    SELECT * FROM user_onboarding_states WHERE user_id = ${userId} LIMIT 1
  `);
  const stateRow: any = Array.isArray(stateRows) ? stateRows[0] : (stateRows as any).rows?.[0];

  const contactOptions: { label: string; type: string; value: string }[] = [];
  const firstOrgLink = links[0];
  const orgContactRows = firstOrgLink
    ? await db.execute(sql`
        SELECT scheduling_inquiry_email, owner_email, name
        FROM organizations WHERE id = ${firstOrgLink.org_id} LIMIT 1
      `)
    : [];
  const orgContactRow: any = Array.isArray(orgContactRows)
    ? orgContactRows[0]
    : (orgContactRows as any).rows?.[0];
  if (orgContactRow?.scheduling_inquiry_email) {
    contactOptions.push({ label: "Contact Organization", type: "email", value: orgContactRow.scheduling_inquiry_email });
  } else if (orgContactRow?.owner_email) {
    contactOptions.push({ label: "Contact Organization", type: "email", value: orgContactRow.owner_email });
  }

  return {
    userType: "guardian" as const,
    isFirstLogin: !stateRow?.first_viewed_at,
    profileConfirmed: !!stateRow?.profile_confirmed_at,
    guardian: {
      id: userRow.id,
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      email: userRow.email,
      phone: userRow.phone,
      smsOptIn: userRow.sms_opt_in,
    },
    linkedAthletes,
    communicationPreferences: {
      smsOptIn: !!userRow.sms_opt_in,
      notificationPreferences: userRow.notification_preferences,
    },
    contactOptions,
  };
}

export async function markOnboardingViewed(userId: string) {
  await db.execute(sql`
    INSERT INTO user_onboarding_states (user_id, first_viewed_at)
    VALUES (${userId}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET first_viewed_at = COALESCE(user_onboarding_states.first_viewed_at, NOW())
  `);
}

export async function confirmAthleteProfile(
  userId: string,
  data: { phone?: string; smsOptIn?: boolean; notificationPreferences?: Record<string, unknown> }
) {
  const parts: string[] = [];
  if (data.phone !== undefined) parts.push(`phone = '${data.phone.replace(/'/g, "''")}'`);
  if (data.smsOptIn !== undefined) parts.push(`sms_opt_in = ${data.smsOptIn}`);
  if (data.notificationPreferences !== undefined) {
    parts.push(`notification_preferences = '${JSON.stringify(data.notificationPreferences).replace(/'/g, "''")}'::jsonb`);
  }
  if (parts.length > 0) {
    await db.execute(sql.raw(`UPDATE users SET ${parts.join(", ")}, updated_at = NOW() WHERE id = '${userId}'`));
  }
  await db.execute(sql`
    INSERT INTO user_onboarding_states (user_id, profile_confirmed_at, first_viewed_at)
    VALUES (${userId}, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE SET profile_confirmed_at = NOW()
  `);
}

export async function confirmGuardianProfile(
  userId: string,
  data: { phone?: string; smsOptIn?: boolean; notificationPreferences?: Record<string, unknown> }
) {
  return confirmAthleteProfile(userId, data);
}
