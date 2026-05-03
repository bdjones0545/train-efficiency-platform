import { storage } from "../storage";

export interface AuditCheck {
  name: string;
  pass: boolean;
  severity: "low" | "medium" | "high" | "critical";
  details: string;
  suggestedFix: string;
}

export interface AuditReport {
  status: "healthy" | "warning" | "critical";
  healthScore: number;
  checks: AuditCheck[];
  warnings: string[];
  recommendations: string[];
  generatedAt: string;
  contactQualityDistribution: {
    high: number;
    medium: number;
    low: number;
    missing: number;
    total: number;
  };
  stageDistribution: Record<string, number>;
  autoExecMetrics: {
    successRate: number;
    engagementRate: number;
    revenuePerAction: number;
    todayCount: number;
    maxPerDay: number;
  };
}

function scoreWeight(severity: "low" | "medium" | "high" | "critical"): number {
  return { low: 2, medium: 5, high: 10, critical: 20 }[severity];
}

export async function runEmailAgentAudit(orgId: string): Promise<AuditReport> {
  const checks: AuditCheck[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  const [settings, prospects, drafts, followUps, allDeals, revenueStats, execLogRaw, perfStats] =
    await Promise.all([
      storage.getEmailAgentSettings(orgId),
      storage.getTeamTrainingProspects(orgId),
      storage.getOutreachDraftsByOrg(orgId),
      storage.getFollowUpsByOrg(orgId),
      storage.getTeamTrainingDeals(orgId),
      storage.getAiRevenueStats(orgId),
      storage.getSetting(`auto_execution_log_${orgId}`),
      storage.getEmailPerformanceStats(orgId),
    ]);

  const execLog: any[] = execLogRaw ? JSON.parse(execLogRaw).slice(-50) : [];
  const sentDrafts = drafts.filter((d) => !!d.sentAt);
  const pendingDrafts = drafts.filter((d) => !d.sentAt && !d.approved);
  const approvedUnsent = drafts.filter((d) => d.approved && !d.sentAt);

  const prospectsWithEmail = prospects.filter((p) => !!p.contactEmail);
  const prospectsWithoutEmail = prospects.filter((p) => !p.contactEmail);
  const dncProspects = prospects.filter((p) => p.outreachStatus === "Do Not Contact");
  const repliedProspects = prospects.filter((p) => p.outreachStatus === "Replied");

  const pendingFollowUps = followUps.filter((f) => f.status === "pending");
  const dueFollowUps = pendingFollowUps.filter(
    (f) => f.scheduledFor && new Date(f.scheduledFor) <= new Date()
  );

  const today = new Date().toDateString();
  const todayExecs = execLog.filter(
    (e) => !e.undone && new Date(e.executedAt).toDateString() === today && e.outcome === "success"
  );
  const successExecs = execLog.filter((e) => e.outcome === "success" && !e.undone);
  const successRate = execLog.length > 0 ? Math.round((successExecs.length / execLog.length) * 100) : 100;

  // ─── CHECK: Prospect discovery ─────────────────────────────────────────────
  checks.push({
    name: "Prospect Discovery Active",
    pass: prospects.length > 0,
    severity: "high",
    details: prospects.length > 0
      ? `${prospects.length} prospects in pipeline.`
      : "No prospects found in pipeline.",
    suggestedFix: prospects.length === 0
      ? "Use the Research New Leads feature to discover local sports organizations."
      : "",
  });

  // ─── CHECK: Duplicate prevention ──────────────────────────────────────────
  const emailCounts: Record<string, number> = {};
  for (const p of prospectsWithEmail) {
    const email = (p.contactEmail || "").toLowerCase();
    emailCounts[email] = (emailCounts[email] || 0) + 1;
  }
  const duplicateEmails = Object.values(emailCounts).filter((c) => c > 1).length;
  checks.push({
    name: "Duplicate Prospects Prevented",
    pass: duplicateEmails === 0,
    severity: "medium",
    details: duplicateEmails === 0
      ? "No duplicate email addresses detected."
      : `${duplicateEmails} duplicate email address(es) found across prospects.`,
    suggestedFix: duplicateEmails > 0
      ? "Review prospects and remove duplicates to avoid sending multiple emails to the same contact."
      : "",
  });

  // ─── CHECK: Contact quality ────────────────────────────────────────────────
  const emailCoverage = prospects.length > 0
    ? Math.round((prospectsWithEmail.length / prospects.length) * 100)
    : 0;
  checks.push({
    name: "Contact Email Coverage",
    pass: emailCoverage >= 70,
    severity: emailCoverage < 40 ? "high" : "medium",
    details: `${prospectsWithEmail.length}/${prospects.length} prospects have email addresses (${emailCoverage}%).`,
    suggestedFix: emailCoverage < 70
      ? "Research contact emails for prospects missing them. Target coach or athletic director emails for best results."
      : "",
  });

  // ─── CHECK: DNC respected ──────────────────────────────────────────────────
  const dncSentDrafts = sentDrafts.filter((d) => {
    const p = (d as any).prospect;
    return p && p.outreachStatus === "Do Not Contact";
  });
  checks.push({
    name: "DNC / Opt-Out Respected",
    pass: dncSentDrafts.length === 0,
    severity: "critical",
    details: dncSentDrafts.length === 0
      ? `${dncProspects.length} DNC prospects correctly excluded from outreach.`
      : `${dncSentDrafts.length} email(s) were sent to Do Not Contact prospects. Immediate review required.`,
    suggestedFix: dncSentDrafts.length > 0
      ? "Audit sent drafts for DNC prospects and add their emails to the opt-out list immediately."
      : "",
  });

  // ─── CHECK: Daily caps ─────────────────────────────────────────────────────
  const dailyLimit = settings.dailyLimit ?? 10;
  const overview = await storage.getEmailAgentOverview(orgId);
  const cappedCorrectly = overview.sentToday <= dailyLimit;
  checks.push({
    name: "Daily Send Caps Enforced",
    pass: cappedCorrectly,
    severity: "high",
    details: cappedCorrectly
      ? `Today: ${overview.sentToday}/${dailyLimit} emails sent. Cap is respected.`
      : `${overview.sentToday} emails sent today, exceeding the configured limit of ${dailyLimit}.`,
    suggestedFix: !cappedCorrectly
      ? "Review and lower the daily send limit in Email Agent Settings."
      : "",
  });

  // ─── CHECK: Drafts created before sends ───────────────────────────────────
  const sentWithoutDraft = sentDrafts.length === 0 && overview.sentToday > 0;
  checks.push({
    name: "Drafts Created Before Sends",
    pass: !sentWithoutDraft,
    severity: "medium",
    details: !sentWithoutDraft
      ? `All sent emails have associated drafts. ${pendingDrafts.length} drafts pending review.`
      : "Some emails appear sent without a draft record. Data may be inconsistent.",
    suggestedFix: sentWithoutDraft
      ? "Check outreach event logs for any emails sent without proper draft records."
      : "",
  });

  // ─── CHECK: Follow-up scheduling ──────────────────────────────────────────
  const followUpRatio = sentDrafts.length > 0
    ? pendingFollowUps.length / sentDrafts.length
    : 0;
  const followUpsHealthy = sentDrafts.length === 0 || followUpRatio >= 0.5;
  checks.push({
    name: "Follow-Ups Scheduled Correctly",
    pass: followUpsHealthy,
    severity: "medium",
    details: followUpsHealthy
      ? `${pendingFollowUps.length} follow-up steps pending across ${sentDrafts.length} sent outreach emails.`
      : `Only ${pendingFollowUps.length} follow-ups scheduled for ${sentDrafts.length} sent emails. Many sequences may be missing.`,
    suggestedFix: !followUpsHealthy
      ? "Verify that follow-up sequences are being scheduled after each initial send. Check follow-up cron logs."
      : "",
  });

  // ─── CHECK: Sequences stop on reply/DNC ──────────────────────────────────
  const repliedPendingFollowUps = pendingFollowUps.filter((f) => {
    const p = (f as any).prospect;
    return p && (p.outreachStatus === "Replied" || p.outreachStatus === "Do Not Contact");
  });
  checks.push({
    name: "Sequences Stop on Reply / DNC",
    pass: repliedPendingFollowUps.length === 0,
    severity: "high",
    details: repliedPendingFollowUps.length === 0
      ? "No pending follow-ups exist for replied or DNC prospects."
      : `${repliedPendingFollowUps.length} follow-up(s) still pending for prospects who replied or are DNC. These should be cancelled.`,
    suggestedFix: repliedPendingFollowUps.length > 0
      ? "Cancel pending follow-up sequences for prospects who have replied or been marked DNC."
      : "",
  });

  // ─── CHECK: Reply classification ──────────────────────────────────────────
  const repliedDrafts = sentDrafts.filter((d) => !!d.repliedAt);
  const classifiedReplies = repliedDrafts.filter((d) => !!d.replyClassification && d.replyClassification !== "unknown");
  const classificationRate = repliedDrafts.length > 0
    ? Math.round((classifiedReplies.length / repliedDrafts.length) * 100)
    : 100;
  checks.push({
    name: "Replies Classified",
    pass: classificationRate >= 80,
    severity: "medium",
    details: repliedDrafts.length === 0
      ? "No replies received yet."
      : `${classifiedReplies.length}/${repliedDrafts.length} replies have a classification (${classificationRate}%).`,
    suggestedFix: classificationRate < 80
      ? "Some replies may not have been processed by the classifier. Check the reply webhook configuration."
      : "",
  });

  // ─── CHECK: Interested replies creating deals ──────────────────────────────
  const interestedDrafts = sentDrafts.filter((d) => d.replyClassification === "interested");
  const dealsForInterested = await Promise.all(
    interestedDrafts.map((d) =>
      storage.getTeamTrainingDealByProspect(d.prospectId, orgId).catch(() => null)
    )
  );
  const interestedWithoutDeal = interestedDrafts.filter((_, i) => !dealsForInterested[i]);
  checks.push({
    name: "Interested Replies Creating Deals",
    pass: interestedWithoutDeal.length === 0,
    severity: "high",
    details: interestedDrafts.length === 0
      ? "No 'interested' replies received yet."
      : interestedWithoutDeal.length === 0
        ? `All ${interestedDrafts.length} interested prospect(s) have deals created.`
        : `${interestedWithoutDeal.length} prospect(s) replied as interested but have no deal created.`,
    suggestedFix: interestedWithoutDeal.length > 0
      ? "Create deals for interested prospects immediately to capture the opportunity and enable pipeline tracking."
      : "",
  });

  // ─── CHECK: Next-best-actions generated ───────────────────────────────────
  const activeProspects = prospects.filter(
    (p) => !["Do Not Contact", "Not Interested"].includes(p.outreachStatus || "")
  );
  checks.push({
    name: "Next-Best-Actions Available",
    pass: activeProspects.length > 0,
    severity: "low",
    details: activeProspects.length > 0
      ? `${activeProspects.length} active prospects eligible for next-best-action recommendations.`
      : "No active prospects available for recommendations.",
    suggestedFix: activeProspects.length === 0
      ? "Add new prospects to your pipeline to enable AI-powered next-best-action recommendations."
      : "",
  });

  // ─── CHECK: Global priority ranking ───────────────────────────────────────
  checks.push({
    name: "Global Priority Ranking Active",
    pass: activeProspects.length > 0 && settings.enabled,
    severity: "low",
    details: settings.enabled
      ? "Email Agent is enabled. Global priority queue is computed on demand."
      : "Email Agent is disabled. Priority ranking is inactive.",
    suggestedFix: !settings.enabled
      ? "Enable the Email Agent in Settings to activate priority ranking and auto-execution."
      : "",
  });

  // ─── CHECK: Auto-execution safety ─────────────────────────────────────────
  const autoEnabled = settings.autoExecuteEnabled === true;
  const maxAutoPerDay = settings.autoExecuteMaxPerDay ?? 3;
  const safeAutoActions = new Set(["send_follow_up", "generate_draft", "send_initial_email"]);
  const unsafeAutoExecs = execLog.filter(
    (e) => !safeAutoActions.has(e.actionType) && !e.undone
  );
  checks.push({
    name: "Auto-Execution Only Runs Safe Actions",
    pass: unsafeAutoExecs.length === 0,
    severity: "critical",
    details: unsafeAutoExecs.length === 0
      ? `Auto-execution ${autoEnabled ? "enabled" : "disabled"}. ${todayExecs.length}/${maxAutoPerDay} safe actions executed today.`
      : `${unsafeAutoExecs.length} potentially unsafe action(s) were auto-executed. Review immediately.`,
    suggestedFix: unsafeAutoExecs.length > 0
      ? "Audit the auto-execution log. Proposals, DNC, and deal-closing actions must never be auto-executed."
      : "",
  });

  // ─── CHECK: Revenue attribution no double-counting ───────────────────────
  const impactFeed = await storage.getAiImpactFeed(orgId, 100);
  const wonEvents = impactFeed.filter((e) => e.outcomeStatus === "won");
  const prospectWinCounts: Record<string, number> = {};
  for (const e of wonEvents) {
    if (e.prospectId && e.attributionRole !== "assist") {
      prospectWinCounts[e.prospectId] = (prospectWinCounts[e.prospectId] || 0) + 1;
    }
  }
  const doubleCountedProspects = Object.values(prospectWinCounts).filter((c) => c > 1).length;
  checks.push({
    name: "Revenue Attribution No Double-Counting",
    pass: doubleCountedProspects === 0,
    severity: "high",
    details: doubleCountedProspects === 0
      ? `Revenue attribution is clean. ${wonEvents.length} win event(s) attributed.`
      : `${doubleCountedProspects} prospect(s) have multiple primary win attributions. Revenue may be inflated.`,
    suggestedFix: doubleCountedProspects > 0
      ? "Review revenue events and ensure only the most recent high-impact action has 'primary' attribution role."
      : "",
  });

  // ─── Compile contact quality distribution ─────────────────────────────────
  const { computeContactQualityScore } = await import("./contact-quality");
  let qHigh = 0, qMed = 0, qLow = 0, qMissing = 0;
  for (const p of prospects) {
    const { score } = computeContactQualityScore(p);
    if (!p.contactEmail) qMissing++;
    else if (score >= 70) qHigh++;
    else if (score >= 40) qMed++;
    else qLow++;
  }

  // ─── Stage distribution ───────────────────────────────────────────────────
  const { computeConversationStage } = await import("./conversation-stage");
  const stageDist: Record<string, number> = {};
  for (const p of prospects) {
    const draftsForP = drafts.filter((d) => d.prospectId === p.id);
    const sentForP = draftsForP.filter((d) => !!d.sentAt);
    const latest = sentForP.sort((a, b) =>
      new Date(b.sentAt!).getTime() - new Date(a.sentAt!).getTime()
    )[0] ?? null;
    const deal = await storage.getTeamTrainingDealByProspect(p.id, orgId).catch(() => null);
    const stage = computeConversationStage({
      prospect: p,
      totalSent: sentForP.length,
      openCount: sentForP.filter((d) => !!d.openedAt).length,
      clicked: sentForP.some((d) => !!d.clickedAt),
      replied: sentForP.some((d) => !!d.repliedAt),
      replyClassification: (latest?.replyClassification ?? null) as any,
      deal: deal ?? null,
    });
    stageDist[stage] = (stageDist[stage] || 0) + 1;
  }

  // ─── Auto-exec performance metrics ────────────────────────────────────────
  const engagedAutoExecs = execLog.filter((e) => {
    if (e.undone || e.outcome !== "success") return false;
    return e.engagementOutcome === true;
  });
  const revenueAutoExecs = execLog.reduce((sum: number, e: any) => {
    if (e.undone || e.outcome !== "success") return sum;
    return sum + (e.revenueAttributed ?? 0);
  }, 0);
  const engagementRate = execLog.length > 0 ? Math.round((engagedAutoExecs.length / Math.max(1, successExecs.length)) * 100) : 0;
  const revenuePerAction = successExecs.length > 0 ? Math.round(revenueAutoExecs / successExecs.length) : 0;

  // ─── Warnings & Recommendations ───────────────────────────────────────────
  if (dueFollowUps.length > 0) {
    warnings.push(`${dueFollowUps.length} follow-up(s) are overdue and have not been sent.`);
    recommendations.push("Process overdue follow-ups manually or ensure the follow-up cron is running.");
  }
  if (approvedUnsent.length > 0) {
    warnings.push(`${approvedUnsent.length} approved draft(s) are waiting to be sent.`);
    recommendations.push("Send approved drafts or enable auto-send to dispatch them automatically.");
  }
  if (emailCoverage < 70) {
    recommendations.push("Improve contact quality by targeting athletic director or coach emails directly.");
  }
  if (perfStats.openRate < 15) {
    warnings.push(`Low open rate: ${perfStats.openRate}%. Consider A/B testing subject lines.`);
    recommendations.push("Test different subject line styles — short, personalized subject lines typically improve open rates.");
  }
  if (perfStats.replyRate < 5 && sentDrafts.length >= 10) {
    warnings.push(`Low reply rate: ${perfStats.replyRate}%. Messaging may need adjustment.`);
    recommendations.push("Shorten email body, add a clear single call-to-action, and reference local sports context.");
  }
  if (interestedWithoutDeal.length > 0) {
    recommendations.push(`Create deals for ${interestedWithoutDeal.length} interested prospect(s) to prevent opportunity loss.`);
  }
  if (qMissing > prospects.length * 0.3) {
    recommendations.push("Over 30% of prospects are missing email addresses. Run additional research to find direct contact info.");
  }

  // ─── Health Score ─────────────────────────────────────────────────────────
  let maxScore = 0;
  let earnedScore = 0;
  for (const c of checks) {
    const w = scoreWeight(c.severity);
    maxScore += w;
    if (c.pass) earnedScore += w;
  }
  const healthScore = maxScore > 0 ? Math.round((earnedScore / maxScore) * 100) : 100;

  const failedCritical = checks.some((c) => !c.pass && c.severity === "critical");
  const failedHigh = checks.filter((c) => !c.pass && c.severity === "high").length;
  const status: "healthy" | "warning" | "critical" =
    failedCritical ? "critical" : failedHigh >= 2 ? "warning" : healthScore >= 80 ? "healthy" : "warning";

  return {
    status,
    healthScore,
    checks,
    warnings,
    recommendations,
    generatedAt: new Date().toISOString(),
    contactQualityDistribution: {
      high: qHigh,
      medium: qMed,
      low: qLow,
      missing: qMissing,
      total: prospects.length,
    },
    stageDistribution: stageDist,
    autoExecMetrics: {
      successRate,
      engagementRate,
      revenuePerAction,
      todayCount: todayExecs.length,
      maxPerDay: maxAutoPerDay,
    },
  };
}
