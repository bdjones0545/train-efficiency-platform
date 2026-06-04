import { db } from "./db";
import { sql } from "drizzle-orm";

function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}
function row0(result: unknown): any {
  return rows(result)[0] ?? null;
}

// ── Time helpers ─────────────────────────────────────────────────────────────

function getNYDatetime() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "long", hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const p: Record<string, string> = {};
  parts.forEach(part => { p[part.type] = part.value; });
  const dayMap: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
  };
  return {
    hour: parseInt(p.hour || "0"),
    minute: parseInt(p.minute || "0"),
    day: dayMap[p.weekday ?? ""] ?? -1,
    dateStr: `${p.year}-${p.month}-${p.day}`,
  };
}

function formatDateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}`;
}

function getWeekRange(fridayDateStr: string): { start: string; end: string; label: string } {
  const parts = fridayDateStr.split("-").map(Number);
  const fri = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const mon = new Date(fri);
  mon.setUTCDate(fri.getUTCDate() - 4);
  const monStr = mon.toISOString().split("T")[0];
  const friStr = fri.toISOString().split("T")[0];
  const mNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return {
    start: monStr,
    end: friStr,
    label: `${mNames[mon.getUTCMonth()]} ${mon.getUTCDate()}–${mNames[fri.getUTCMonth()]} ${fri.getUTCDate()}`,
  };
}

// ── Org branding ─────────────────────────────────────────────────────────────

async function getOrgBranding(orgId: string): Promise<{ name: string; color: string }> {
  try {
    const { storage } = await import("./storage");
    const org = await storage.getOrganizationById(orgId);
    return { name: (org as any)?.name || "Training Center", color: (org as any)?.primaryColor || "#16a34a" };
  } catch {
    return { name: "Training Center", color: "#16a34a" };
  }
}

// ── SendGrid ──────────────────────────────────────────────────────────────────

async function getSendGridSettings() {
  try {
    const sgMail = (await import("@sendgrid/mail")).default;
    const { getConnectionSettings } = await import("./replit_integrations/sendgrid");
    const settings = await getConnectionSettings();
    if (!settings?.api_key || !settings?.from_email) return null;
    sgMail.setApiKey(settings.api_key);
    return { sgMail, fromEmail: settings.from_email as string };
  } catch {
    return null;
  }
}

// ── Duplicate-send guard ──────────────────────────────────────────────────────

async function alreadySent(
  orgId: string,
  programId: string,
  recipientEmail: string,
  reportType: "daily" | "weekly",
  periodStart: string,
): Promise<boolean> {
  const existing = row0(await db.execute(sql`
    SELECT id FROM attendance_report_email_history
    WHERE org_id = ${orgId} AND attendance_program_id = ${programId}
      AND recipient_email = ${recipientEmail}
      AND report_type = ${reportType}
      AND period_start = ${periodStart}::date
    LIMIT 1
  `));
  return !!existing;
}

// ── Stats queries ─────────────────────────────────────────────────────────────

async function getDailyStats(orgId: string, programId: string, dateStr: string) {
  const totals = row0(await db.execute(sql`
    SELECT COUNT(*) AS total, COUNT(DISTINCT athlete_email) AS unique_count
    FROM attendance_records
    WHERE organization_id = ${orgId} AND program_id = ${programId}
      AND DATE(created_at AT TIME ZONE 'America/New_York') = ${dateStr}::date
  `));
  const newRow = row0(await db.execute(sql`
    SELECT COUNT(*) AS new_count FROM (
      SELECT athlete_email FROM attendance_records
      WHERE organization_id = ${orgId} AND program_id = ${programId}
      GROUP BY athlete_email
      HAVING MIN(DATE(created_at AT TIME ZONE 'America/New_York')) = ${dateStr}::date
    ) sub
  `));
  const attendees = rows(await db.execute(sql`
    SELECT DISTINCT ON (athlete_email)
      athlete_email AS email,
      TRIM(CONCAT(COALESCE(athlete_first_name,''), ' ', COALESCE(athlete_last_name,''))) AS name,
      sport,
      visit_number AS total_visits
    FROM attendance_records
    WHERE organization_id = ${orgId} AND program_id = ${programId}
      AND DATE(created_at AT TIME ZONE 'America/New_York') = ${dateStr}::date
    ORDER BY athlete_email, visit_number DESC
  `));
  const sports = rows(await db.execute(sql`
    SELECT sport, COUNT(*) AS count FROM attendance_records
    WHERE organization_id = ${orgId} AND program_id = ${programId}
      AND DATE(created_at AT TIME ZONE 'America/New_York') = ${dateStr}::date
      AND sport IS NOT NULL AND sport != ''
    GROUP BY sport ORDER BY count DESC
  `));
  const rewardsToday = rows(await db.execute(sql`
    SELECT are.athlete_email AS email,
           art.reward_name,
           TRIM(CONCAT(COALESCE(ar2.athlete_first_name,''), ' ', COALESCE(ar2.athlete_last_name,''))) AS name
    FROM attendance_rewards_earned are
    JOIN attendance_reward_tiers art ON art.id = are.tier_id
    LEFT JOIN LATERAL (
      SELECT athlete_first_name, athlete_last_name FROM attendance_records
      WHERE athlete_email = are.athlete_email AND program_id = ${programId}
      ORDER BY created_at DESC LIMIT 1
    ) ar2 ON true
    WHERE are.organization_id = ${orgId} AND are.program_id = ${programId}
      AND DATE(are.created_at AT TIME ZONE 'America/New_York') = ${dateStr}::date
  `));
  const total = Number(totals?.total || 0);
  const unique = Number(totals?.unique_count || 0);
  const newAthletes = Number(newRow?.new_count || 0);
  return { total, unique, newAthletes, returning: Math.max(0, unique - newAthletes), attendees, sports, rewardsToday };
}

async function getWeeklyStats(orgId: string, programId: string, weekStart: string, weekEnd: string) {
  const totals = row0(await db.execute(sql`
    SELECT COUNT(*) AS total, COUNT(DISTINCT athlete_email) AS unique_count
    FROM attendance_records
    WHERE organization_id = ${orgId} AND program_id = ${programId}
      AND DATE(created_at AT TIME ZONE 'America/New_York') BETWEEN ${weekStart}::date AND ${weekEnd}::date
  `));
  const newRow = row0(await db.execute(sql`
    SELECT COUNT(*) AS new_count FROM (
      SELECT athlete_email FROM attendance_records
      WHERE organization_id = ${orgId} AND program_id = ${programId}
      GROUP BY athlete_email
      HAVING MIN(DATE(created_at AT TIME ZONE 'America/New_York')) BETWEEN ${weekStart}::date AND ${weekEnd}::date
    ) sub
  `));
  const topAthletes = rows(await db.execute(sql`
    SELECT athlete_email AS email,
           MAX(TRIM(CONCAT(COALESCE(athlete_first_name,''), ' ', COALESCE(athlete_last_name,'')))) AS name,
           MAX(sport) AS sport,
           COUNT(*) AS week_visits
    FROM attendance_records
    WHERE organization_id = ${orgId} AND program_id = ${programId}
      AND DATE(created_at AT TIME ZONE 'America/New_York') BETWEEN ${weekStart}::date AND ${weekEnd}::date
    GROUP BY athlete_email ORDER BY week_visits DESC LIMIT 10
  `));
  const byDayRaw = rows(await db.execute(sql`
    SELECT DATE(created_at AT TIME ZONE 'America/New_York') AS date, COUNT(*) AS count
    FROM attendance_records
    WHERE organization_id = ${orgId} AND program_id = ${programId}
      AND DATE(created_at AT TIME ZONE 'America/New_York') BETWEEN ${weekStart}::date AND ${weekEnd}::date
    GROUP BY 1 ORDER BY 1 ASC
  `));
  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const byDay = byDayRaw.map((d: any) => {
    const dt = new Date(String(d.date) + "T12:00:00Z");
    return { day: `${dayNames[dt.getUTCDay()]} ${formatDateLabel(String(d.date))}`, count: Number(d.count) };
  });
  const rewardsEarnedRow = row0(await db.execute(sql`
    SELECT COUNT(*) AS count FROM attendance_rewards_earned
    WHERE organization_id = ${orgId} AND program_id = ${programId}
      AND DATE(created_at AT TIME ZONE 'America/New_York') BETWEEN ${weekStart}::date AND ${weekEnd}::date
  `));
  const nearReward = rows(await db.execute(sql`
    SELECT sub.email, sub.name, sub.current_visits, t.visit_count AS next_visit_count,
           t.reward_name AS next_reward, (t.visit_count - sub.current_visits) AS visits_away
    FROM (
      SELECT athlete_email AS email,
             MAX(TRIM(CONCAT(COALESCE(athlete_first_name,''), ' ', COALESCE(athlete_last_name,'')))) AS name,
             MAX(visit_number) AS current_visits
      FROM attendance_records WHERE organization_id = ${orgId} AND program_id = ${programId}
      GROUP BY athlete_email
    ) sub
    JOIN attendance_reward_tiers t ON t.program_id = ${programId} AND t.active = true
      AND t.visit_count > sub.current_visits
    WHERE (t.visit_count - sub.current_visits) <= 3
    ORDER BY visits_away ASC LIMIT 10
  `));
  const total = Number(totals?.total || 0);
  const unique = Number(totals?.unique_count || 0);
  const newAthletes = Number(newRow?.new_count || 0);
  return {
    total, unique, newAthletes, returning: Math.max(0, unique - newAthletes),
    topAthletes, byDay, rewardsEarned: Number(rewardsEarnedRow?.count || 0), nearReward,
  };
}

// ── Email HTML builders ───────────────────────────────────────────────────────

function buildDailyHtml(p: { orgName: string; orgColor: string; programName: string; dateLabel: string; stats: any; dashboardUrl: string }): string {
  const { orgName, orgColor, programName, dateLabel, stats, dashboardUrl } = p;
  const attendeeRows = (stats.attendees || []).map((a: any) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;">${a.name || a.email}</td><td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;color:#aaa;">${a.email}</td><td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;color:#aaa;">${a.sport || "—"}</td><td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;text-align:center;font-weight:600;color:${orgColor};">${a.total_visits}</td></tr>`
  ).join("");
  const sportRows = (stats.sports || []).map((s: any) =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #2a2a2a;">${s.sport}</td><td style="padding:6px 12px;border-bottom:1px solid #2a2a2a;text-align:right;color:${orgColor};font-weight:600;">${s.count}</td></tr>`
  ).join("");
  const rewardRows = (stats.rewardsToday || []).map((r: any) =>
    `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #2a2a2a;"><span style="color:#f59e0b;">🏆</span><strong>${r.name || r.email}</strong><span style="color:#aaa;margin-left:auto;font-size:13px;">${r.reward_name}</span></div>`
  ).join("");
  return `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#111;color:#eee;border-radius:8px;overflow:hidden;">
  <div style="background:${orgColor};padding:24px 32px;">
    <p style="margin:0 0 4px;font-size:12px;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:1px;">Daily Attendance Summary</p>
    <h1 style="margin:0;font-size:22px;color:#fff;">${programName}</h1>
    <p style="margin:4px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">${dateLabel}</p>
  </div>
  <div style="padding:28px 32px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr>
      <td style="width:50%;padding-right:8px;"><div style="background:#1a1a1a;border-radius:8px;padding:16px;text-align:center;"><p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Total Check-Ins</p><p style="margin:0;font-size:28px;font-weight:700;color:${orgColor};">${stats.total}</p></div></td>
      <td style="width:50%;padding-left:8px;"><div style="background:#1a1a1a;border-radius:8px;padding:16px;text-align:center;"><p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Unique Athletes</p><p style="margin:0;font-size:28px;font-weight:700;color:#60a5fa;">${stats.unique}</p></div></td>
    </tr><tr style="height:12px;"></tr><tr>
      <td style="width:50%;padding-right:8px;"><div style="background:#1a1a1a;border-radius:8px;padding:16px;text-align:center;"><p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">New Athletes</p><p style="margin:0;font-size:28px;font-weight:700;color:#a78bfa;">${stats.newAthletes}</p></div></td>
      <td style="width:50%;padding-left:8px;"><div style="background:#1a1a1a;border-radius:8px;padding:16px;text-align:center;"><p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Returning Athletes</p><p style="margin:0;font-size:28px;font-weight:700;color:#34d399;">${stats.returning}</p></div></td>
    </tr></table>
    ${attendeeRows ? `<h3 style="margin:0 0 10px;font-size:14px;font-weight:600;">Today's Attendees</h3><div style="border-radius:8px;overflow:hidden;border:1px solid #2a2a2a;margin-bottom:24px;"><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#1a1a1a;"><th style="padding:9px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;">Name</th><th style="padding:9px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;">Email</th><th style="padding:9px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;">Sport</th><th style="padding:9px 12px;text-align:center;font-size:11px;color:#888;text-transform:uppercase;">Total Visits</th></tr></thead><tbody>${attendeeRows}</tbody></table></div>` : `<p style="color:#888;font-size:14px;margin-bottom:24px;">No check-ins today.</p>`}
    ${sportRows ? `<h3 style="margin:0 0 10px;font-size:14px;font-weight:600;">Sport Breakdown</h3><div style="border-radius:8px;overflow:hidden;border:1px solid #2a2a2a;margin-bottom:24px;"><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#1a1a1a;"><th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;">Sport</th><th style="padding:8px 12px;text-align:right;font-size:11px;color:#888;text-transform:uppercase;">Athletes</th></tr></thead><tbody>${sportRows}</tbody></table></div>` : ""}
    ${rewardRows ? `<h3 style="margin:0 0 10px;font-size:14px;font-weight:600;">🏆 Rewards Earned Today</h3><div style="background:#1a1a1a;border-radius:8px;padding:12px 16px;margin-bottom:24px;">${rewardRows}</div>` : ""}
    <div style="text-align:center;margin-top:24px;"><a href="${dashboardUrl}" style="display:inline-block;background:${orgColor};color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:14px;">View Attendance Dashboard →</a></div>
    <p style="font-size:11px;color:#555;margin-top:24px;text-align:center;">${orgName} · Powered by TrainEfficiency</p>
  </div></div>`;
}

function buildWeeklyHtml(p: { orgName: string; orgColor: string; programName: string; weekRange: string; stats: any; dashboardUrl: string }): string {
  const { orgName, orgColor, programName, weekRange, stats, dashboardUrl } = p;
  const topRows = (stats.topAthletes || []).slice(0, 10).map((a: any, i: number) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;color:#666;">${i + 1}</td><td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;">${a.name || a.email}</td><td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;color:#aaa;">${a.sport || "—"}</td><td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;text-align:center;font-weight:600;color:${orgColor};">${a.week_visits}</td></tr>`
  ).join("");
  const byDayRows = (stats.byDay || []).map((d: any) =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #2a2a2a;">${d.day}</td><td style="padding:6px 12px;border-bottom:1px solid #2a2a2a;text-align:right;color:${orgColor};font-weight:600;">${d.count}</td></tr>`
  ).join("");
  const nearRows = (stats.nearReward || []).map((a: any) =>
    `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #2a2a2a;"><span style="flex:1;">${a.name || a.email}</span><span style="color:#aaa;font-size:13px;">→ ${a.next_reward}</span><span style="background:#2a2a2a;color:${orgColor};font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;white-space:nowrap;">${a.visits_away} away</span></div>`
  ).join("");
  return `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#111;color:#eee;border-radius:8px;overflow:hidden;">
  <div style="background:${orgColor};padding:24px 32px;">
    <p style="margin:0 0 4px;font-size:12px;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:1px;">Weekly Attendance Summary</p>
    <h1 style="margin:0;font-size:22px;color:#fff;">${programName}</h1>
    <p style="margin:4px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">${weekRange}</p>
  </div>
  <div style="padding:28px 32px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr>
      <td style="width:50%;padding-right:8px;"><div style="background:#1a1a1a;border-radius:8px;padding:16px;text-align:center;"><p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Total Check-Ins</p><p style="margin:0;font-size:28px;font-weight:700;color:${orgColor};">${stats.total}</p></div></td>
      <td style="width:50%;padding-left:8px;"><div style="background:#1a1a1a;border-radius:8px;padding:16px;text-align:center;"><p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Unique Athletes</p><p style="margin:0;font-size:28px;font-weight:700;color:#60a5fa;">${stats.unique}</p></div></td>
    </tr><tr style="height:12px;"></tr><tr>
      <td style="width:50%;padding-right:8px;"><div style="background:#1a1a1a;border-radius:8px;padding:16px;text-align:center;"><p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">New Athletes</p><p style="margin:0;font-size:28px;font-weight:700;color:#a78bfa;">${stats.newAthletes}</p></div></td>
      <td style="width:50%;padding-left:8px;"><div style="background:#1a1a1a;border-radius:8px;padding:16px;text-align:center;"><p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Returning Athletes</p><p style="margin:0;font-size:28px;font-weight:700;color:#34d399;">${stats.returning}</p></div></td>
    </tr></table>
    ${stats.rewardsEarned > 0 ? `<div style="background:#1a1a1a;border-radius:8px;padding:14px 20px;margin-bottom:24px;display:flex;align-items:center;gap:12px;"><span style="font-size:22px;">🏆</span><div><p style="margin:0;font-size:18px;font-weight:700;color:#f59e0b;">${stats.rewardsEarned} reward${stats.rewardsEarned === 1 ? "" : "s"} earned this week</p></div></div>` : ""}
    ${topRows ? `<h3 style="margin:0 0 10px;font-size:14px;font-weight:600;">Top Attendees</h3><div style="border-radius:8px;overflow:hidden;border:1px solid #2a2a2a;margin-bottom:24px;"><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#1a1a1a;"><th style="padding:9px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;">#</th><th style="padding:9px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;">Athlete</th><th style="padding:9px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;">Sport</th><th style="padding:9px 12px;text-align:center;font-size:11px;color:#888;text-transform:uppercase;">Visits</th></tr></thead><tbody>${topRows}</tbody></table></div>` : `<p style="color:#888;font-size:14px;margin-bottom:24px;">No check-ins this week.</p>`}
    ${byDayRows ? `<h3 style="margin:0 0 10px;font-size:14px;font-weight:600;">Attendance by Day</h3><div style="border-radius:8px;overflow:hidden;border:1px solid #2a2a2a;margin-bottom:24px;"><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#1a1a1a;"><th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;">Day</th><th style="padding:8px 12px;text-align:right;font-size:11px;color:#888;text-transform:uppercase;">Check-Ins</th></tr></thead><tbody>${byDayRows}</tbody></table></div>` : ""}
    ${nearRows ? `<h3 style="margin:0 0 10px;font-size:14px;font-weight:600;">🎯 Athletes Close to Rewards</h3><div style="background:#1a1a1a;border-radius:8px;padding:12px 16px;margin-bottom:24px;">${nearRows}</div>` : ""}
    <div style="text-align:center;margin-top:24px;"><a href="${dashboardUrl}" style="display:inline-block;background:${orgColor};color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:14px;">View Attendance Dashboard →</a></div>
    <p style="font-size:11px;color:#555;margin-top:24px;text-align:center;">${orgName} · Powered by TrainEfficiency</p>
  </div></div>`;
}

// ── Report senders ────────────────────────────────────────────────────────────

export async function sendDailyReports(dateStr: string): Promise<void> {
  const sg = await getSendGridSettings();
  if (!sg) { console.log("[AttendanceReportCron] SendGrid not configured — skipping"); return; }

  const programs = rows(await db.execute(sql`
    SELECT DISTINCT ap.id AS program_id, ap.organization_id, ap.name AS program_name
    FROM athletic_programs ap
    JOIN attendance_report_recipients arr ON arr.attendance_program_id = ap.id
    WHERE ap.type = 'attendance_tracker' AND arr.active = true AND arr.receive_daily = true
  `));

  for (const prog of programs) {
    const { program_id, organization_id, program_name } = prog;
    const { name: orgName, color: orgColor } = await getOrgBranding(organization_id);
    const dashboardUrl = `https://www.efficiencystrengthtraining.com/admin/attendance-tracker`;
    const stats = await getDailyStats(organization_id, program_id, dateStr);
    const dateLabel = formatDateLabel(dateStr);
    const html = buildDailyHtml({ orgName, orgColor, programName: program_name, dateLabel, stats, dashboardUrl });
    const subject = `Attendance Summary — ${program_name} — ${dateLabel}`;

    const recipients = rows(await db.execute(sql`
      SELECT email, name FROM attendance_report_recipients
      WHERE attendance_program_id = ${program_id} AND active = true AND receive_daily = true
    `));

    for (const rec of recipients) {
      if (await alreadySent(organization_id, program_id, rec.email, "daily", dateStr)) continue;
      try {
        await sg.sgMail.send({ to: rec.email, from: { email: sg.fromEmail, name: orgName }, subject, html });
        await db.execute(sql`
          INSERT INTO attendance_report_email_history
            (org_id, attendance_program_id, recipient_email, report_type, period_start, period_end, sent_at, status)
          VALUES (${organization_id}, ${program_id}, ${rec.email}, 'daily', ${dateStr}::date, ${dateStr}::date, NOW(), 'sent')
        `);
        console.log(`[AttendanceReportCron] Daily ✓ → ${rec.email} [${program_name}]`);
      } catch (e: any) {
        await db.execute(sql`
          INSERT INTO attendance_report_email_history
            (org_id, attendance_program_id, recipient_email, report_type, period_start, period_end, sent_at, status, error_message)
          VALUES (${organization_id}, ${program_id}, ${rec.email}, 'daily', ${dateStr}::date, ${dateStr}::date, NOW(), 'failed', ${String(e?.message || e)})
        `).catch(() => {});
        console.error(`[AttendanceReportCron] Daily ✗ → ${rec.email}:`, e?.message);
      }
    }
  }
}

export async function sendWeeklyReports(fridayDateStr: string): Promise<void> {
  const sg = await getSendGridSettings();
  if (!sg) return;

  const { start: weekStart, end: weekEnd, label: weekRange } = getWeekRange(fridayDateStr);

  const programs = rows(await db.execute(sql`
    SELECT DISTINCT ap.id AS program_id, ap.organization_id, ap.name AS program_name
    FROM athletic_programs ap
    JOIN attendance_report_recipients arr ON arr.attendance_program_id = ap.id
    WHERE ap.type = 'attendance_tracker' AND arr.active = true AND arr.receive_weekly = true
  `));

  for (const prog of programs) {
    const { program_id, organization_id, program_name } = prog;
    const { name: orgName, color: orgColor } = await getOrgBranding(organization_id);
    const dashboardUrl = `https://www.efficiencystrengthtraining.com/admin/attendance-tracker`;
    const stats = await getWeeklyStats(organization_id, program_id, weekStart, weekEnd);
    const html = buildWeeklyHtml({ orgName, orgColor, programName: program_name, weekRange, stats, dashboardUrl });
    const subject = `Weekly Attendance Summary — ${program_name} — ${weekRange}`;

    const recipients = rows(await db.execute(sql`
      SELECT email, name FROM attendance_report_recipients
      WHERE attendance_program_id = ${program_id} AND active = true AND receive_weekly = true
    `));

    for (const rec of recipients) {
      if (await alreadySent(organization_id, program_id, rec.email, "weekly", weekStart)) continue;
      try {
        await sg.sgMail.send({ to: rec.email, from: { email: sg.fromEmail, name: orgName }, subject, html });
        await db.execute(sql`
          INSERT INTO attendance_report_email_history
            (org_id, attendance_program_id, recipient_email, report_type, period_start, period_end, sent_at, status)
          VALUES (${organization_id}, ${program_id}, ${rec.email}, 'weekly', ${weekStart}::date, ${weekEnd}::date, NOW(), 'sent')
        `);
        console.log(`[AttendanceReportCron] Weekly ✓ → ${rec.email} [${program_name}]`);
      } catch (e: any) {
        await db.execute(sql`
          INSERT INTO attendance_report_email_history
            (org_id, attendance_program_id, recipient_email, report_type, period_start, period_end, sent_at, status, error_message)
          VALUES (${organization_id}, ${program_id}, ${rec.email}, 'weekly', ${weekStart}::date, ${weekEnd}::date, NOW(), 'failed', ${String(e?.message || e)})
        `).catch(() => {});
        console.error(`[AttendanceReportCron] Weekly ✗ → ${rec.email}:`, e?.message);
      }
    }
  }
}

// ── Test sender (exposed as HTTP endpoint) ───────────────────────────────────

export async function sendTestReport(
  programId: string,
  recipientEmail: string,
  reportType: "daily" | "weekly",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const sg = await getSendGridSettings();
    if (!sg) return { ok: false, error: "SendGrid not configured" };

    const prog = await (async () => {
      const { db: _db } = await import("./db");
      return row0(await _db.execute(sql`
        SELECT ap.id, ap.organization_id, ap.name FROM athletic_programs ap WHERE ap.id = ${programId}
      `));
    })();
    if (!prog) return { ok: false, error: "Program not found" };

    const { name: orgName, color: orgColor } = await getOrgBranding(prog.organization_id);
    const { dateStr } = getNYDatetime();
    const dashboardUrl = `https://www.efficiencystrengthtraining.com/admin/attendance-tracker`;

    let subject: string;
    let html: string;

    if (reportType === "daily") {
      const stats = await getDailyStats(prog.organization_id, prog.id, dateStr);
      const dateLabel = formatDateLabel(dateStr);
      subject = `[TEST] Attendance Summary — ${prog.name} — ${dateLabel}`;
      html = buildDailyHtml({ orgName, orgColor, programName: prog.name, dateLabel, stats, dashboardUrl });
    } else {
      const { start: weekStart, end: weekEnd, label: weekRange } = getWeekRange(dateStr);
      const stats = await getWeeklyStats(prog.organization_id, prog.id, weekStart, weekEnd);
      subject = `[TEST] Weekly Attendance Summary — ${prog.name} — ${weekRange}`;
      html = buildWeeklyHtml({ orgName, orgColor, programName: prog.name, weekRange, stats, dashboardUrl });
    }

    await sg.sgMail.send({ to: recipientEmail, from: { email: sg.fromEmail, name: orgName }, subject, html });
    console.log(`[AttendanceReportCron] Test ${reportType} sent → ${recipientEmail}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ── Cron scheduler ────────────────────────────────────────────────────────────

export function startAttendanceReportCron(): void {
  setInterval(() => {
    try {
      const { hour, minute, day, dateStr } = getNYDatetime();
      if (hour === 17 && minute === 0) {
        const isWeekday = day >= 1 && day <= 5;
        const isFriday = day === 5;
        if (isWeekday) {
          console.log(`[AttendanceReportCron] Firing daily reports for ${dateStr}`);
          sendDailyReports(dateStr).catch(console.error);
        }
        if (isFriday) {
          console.log(`[AttendanceReportCron] Firing weekly reports for ${dateStr}`);
          sendWeeklyReports(dateStr).catch(console.error);
        }
      }
    } catch (e) {
      console.error("[AttendanceReportCron] tick error:", e);
    }
  }, 60_000);
  console.log("[AttendanceReportCron] Started — daily Mon–Fri 5 PM ET, weekly Fri 5 PM ET");
}
