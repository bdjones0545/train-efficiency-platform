import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";

function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}
function row0(result: unknown): any {
  return rows(result)[0] ?? null;
}

async function getOrgBrandingForAttendance(orgId: string) {
  try {
    const org = await storage.getOrganizationById(orgId);
    if (!org) return { name: "Training Center", color: "#16a34a" };
    return { name: org.name || "Training Center", color: org.primaryColor || "#16a34a" };
  } catch {
    return { name: "Training Center", color: "#16a34a" };
  }
}

async function createTables() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_programs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id VARCHAR NOT NULL,
        program_id VARCHAR NOT NULL UNIQUE,
        description TEXT,
        location VARCHAR,
        start_date VARCHAR,
        end_date VARCHAR,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_program_fields (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id VARCHAR NOT NULL,
        program_id VARCHAR NOT NULL,
        field_name VARCHAR NOT NULL,
        label VARCHAR NOT NULL,
        field_type VARCHAR NOT NULL DEFAULT 'text',
        visibility VARCHAR NOT NULL DEFAULT 'required',
        display_order INTEGER NOT NULL DEFAULT 0,
        options JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_reward_tiers (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id VARCHAR NOT NULL,
        program_id VARCHAR NOT NULL,
        visit_count INTEGER NOT NULL,
        reward_name VARCHAR NOT NULL,
        reward_description TEXT,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_qr_codes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id VARCHAR NOT NULL,
        program_id VARCHAR NOT NULL UNIQUE,
        public_slug VARCHAR NOT NULL UNIQUE,
        qr_code_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id VARCHAR NOT NULL,
        program_id VARCHAR NOT NULL,
        athlete_email VARCHAR NOT NULL,
        athlete_first_name VARCHAR,
        athlete_last_name VARCHAR,
        phone VARCHAR,
        sport VARCHAR,
        position VARCHAR,
        school VARCHAR,
        grad_year VARCHAR,
        team VARCHAR,
        age VARCHAR,
        extra_fields JSONB DEFAULT '{}'::jsonb,
        visit_number INTEGER NOT NULL DEFAULT 1,
        lead_id VARCHAR,
        ip_address VARCHAR,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_rewards_earned (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id VARCHAR NOT NULL,
        program_id VARCHAR NOT NULL,
        tier_id VARCHAR NOT NULL,
        athlete_email VARCHAR NOT NULL,
        visit_count_at_earned INTEGER NOT NULL,
        notification_sent_at TIMESTAMP,
        redeemed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_email_history (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id VARCHAR NOT NULL,
        program_id VARCHAR NOT NULL,
        athlete_email VARCHAR NOT NULL,
        email_type VARCHAR NOT NULL,
        subject VARCHAR,
        status VARCHAR NOT NULL DEFAULT 'sent',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_report_recipients (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id VARCHAR NOT NULL,
        attendance_program_id VARCHAR NOT NULL,
        coach_id VARCHAR,
        email VARCHAR NOT NULL,
        name VARCHAR NOT NULL,
        receive_daily BOOLEAN NOT NULL DEFAULT true,
        receive_weekly BOOLEAN NOT NULL DEFAULT true,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(attendance_program_id, email)
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_report_email_history (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id VARCHAR NOT NULL,
        attendance_program_id VARCHAR NOT NULL,
        recipient_email VARCHAR NOT NULL,
        report_type VARCHAR NOT NULL,
        period_start DATE,
        period_end DATE,
        sent_at TIMESTAMP,
        status VARCHAR NOT NULL DEFAULT 'sent',
        sendgrid_message_id VARCHAR,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("[Attendance] Tables ready");
  } catch (e) {
    console.error("[Attendance] Table creation error:", e);
  }
}

async function sendAttendanceEmail(params: {
  orgId: string;
  programId: string;
  athleteEmail: string;
  athleteFirstName: string;
  orgName: string;
  orgColor: string;
  visitCount: number;
  rewardTiers: any[];
  programName: string;
  emailType: "confirmation" | "reward_earned" | "reward_approaching";
  rewardName?: string;
  visitsAway?: number;
}) {
  const { orgId, programId, athleteEmail, athleteFirstName, orgName, orgColor, visitCount, rewardTiers, programName, emailType, rewardName, visitsAway } = params;

  const activeTiers = rewardTiers.filter(t => t.active).sort((a, b) => a.visit_count - b.visit_count);
  const nextReward = activeTiers.find(t => t.visit_count > visitCount);

  try {
    const sgMail = (await import("@sendgrid/mail")).default;
    const { getConnectionSettings } = await import("./replit_integrations/sendgrid");
    const settings = await getConnectionSettings();
    if (!settings?.api_key || !settings?.from_email) return;

    sgMail.setApiKey(settings.api_key);

    let subject = "";
    let html = "";

    if (emailType === "confirmation") {
      subject = `Attendance Confirmed — ${programName}`;
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #eee; border-radius: 8px; overflow: hidden;">
          <div style="background: ${orgColor}; padding: 24px 32px;">
            <h1 style="margin: 0; font-size: 22px; color: #fff;">Attendance Confirmed ✓</h1>
          </div>
          <div style="padding: 32px;">
            <p style="font-size: 16px; margin-top: 0;">Hey ${athleteFirstName || "Athlete"},</p>
            <p style="font-size: 15px; line-height: 1.6;">Thanks for attending <strong>${orgName}</strong>!</p>
            <div style="background: #1a1a1a; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="margin: 0 0 8px; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Your Progress</p>
              <p style="margin: 0; font-size: 32px; font-weight: 700; color: ${orgColor};">${visitCount} <span style="font-size: 16px; color: #aaa; font-weight: 400;">sessions</span></p>
            </div>
            ${nextReward ? `
            <div style="background: #1a1a1a; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="margin: 0 0 8px; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Next Reward</p>
              <p style="margin: 0 0 4px; font-size: 18px; font-weight: 600; color: #fff;">${nextReward.reward_name}</p>
              <p style="margin: 0; font-size: 14px; color: #aaa;">${nextReward.visit_count - visitCount} session${nextReward.visit_count - visitCount === 1 ? "" : "s"} away</p>
            </div>
            ` : `
            <div style="background: #1a1a1a; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="margin: 0; font-size: 16px; color: ${orgColor}; font-weight: 600;">🏆 You've earned all rewards! Keep showing up.</p>
            </div>
            `}
            <p style="font-size: 14px; color: #888; margin-top: 32px;">See you next time! — ${orgName}</p>
          </div>
        </div>
      `;
    } else if (emailType === "reward_earned") {
      subject = `🏆 You Earned: ${rewardName} — ${orgName}`;
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #eee; border-radius: 8px; overflow: hidden;">
          <div style="background: ${orgColor}; padding: 24px 32px;">
            <h1 style="margin: 0; font-size: 22px; color: #fff;">You Unlocked a Reward! 🏆</h1>
          </div>
          <div style="padding: 32px;">
            <p style="font-size: 16px; margin-top: 0;">Congratulations ${athleteFirstName || "Athlete"}!</p>
            <div style="background: #1a1a1a; border-radius: 8px; padding: 24px; margin: 20px 0; text-align: center;">
              <p style="margin: 0 0 8px; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px;">You Earned</p>
              <p style="margin: 0; font-size: 28px; font-weight: 700; color: ${orgColor};">${rewardName}</p>
              <p style="margin: 8px 0 0; font-size: 14px; color: #aaa;">After ${visitCount} sessions at ${orgName}</p>
            </div>
            <p style="font-size: 15px; line-height: 1.6;">Stop by the front desk to claim your reward. You've earned it!</p>
            <p style="font-size: 14px; color: #888; margin-top: 32px;">Keep up the great work! — ${orgName}</p>
          </div>
        </div>
      `;
    } else if (emailType === "reward_approaching") {
      subject = `Almost There! ${visitsAway} Visit${visitsAway === 1 ? "" : "s"} Until ${rewardName}`;
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #eee; border-radius: 8px; overflow: hidden;">
          <div style="background: ${orgColor}; padding: 24px 32px;">
            <h1 style="margin: 0; font-size: 22px; color: #fff;">You're Almost There! 🔥</h1>
          </div>
          <div style="padding: 32px;">
            <p style="font-size: 16px; margin-top: 0;">Hey ${athleteFirstName || "Athlete"},</p>
            <div style="background: #1a1a1a; border-radius: 8px; padding: 24px; margin: 20px 0; text-align: center;">
              <p style="margin: 0 0 4px; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Only ${visitsAway} Visit${visitsAway === 1 ? "" : "s"} Until</p>
              <p style="margin: 0; font-size: 24px; font-weight: 700; color: ${orgColor};">${rewardName}</p>
            </div>
            <p style="font-size: 15px; line-height: 1.6;">Keep showing up — you're ${visitsAway} session${visitsAway === 1 ? "" : "s"} away from your next reward!</p>
            <p style="font-size: 14px; color: #888; margin-top: 32px;">See you soon! — ${orgName}</p>
          </div>
        </div>
      `;
    }

    await sgMail.send({
      to: athleteEmail,
      from: { email: settings.from_email, name: orgName },
      subject,
      html,
    });

    await db.execute(sql`
      INSERT INTO attendance_email_history (organization_id, program_id, athlete_email, email_type, subject, status)
      VALUES (${orgId}, ${programId}, ${athleteEmail}, ${emailType}, ${subject}, 'sent')
    `);
  } catch (e: any) {
    console.error("[Attendance Email] Error:", e?.message || e);
    try {
      await db.execute(sql`
        INSERT INTO attendance_email_history (organization_id, program_id, athlete_email, email_type, subject, status, error_message)
        VALUES (${orgId}, ${programId}, ${athleteEmail}, ${emailType}, 'Attendance email', 'failed', ${String(e?.message || e)})
      `);
    } catch {}
  }
}

export async function registerAttendanceRoutes(app: Express) {
  await createTables();

  // ─── Get program config by programId ─────────────────────────────────────
  app.get("/api/attendance-programs/:programId/config", async (req, res) => {
    try {
      const { programId } = req.params;
      const config = row0(await db.execute(sql`
        SELECT * FROM attendance_programs WHERE program_id = ${programId}
      `));
      const fields = rows(await db.execute(sql`
        SELECT * FROM attendance_program_fields WHERE program_id = ${programId} ORDER BY display_order ASC
      `));
      const rewards = rows(await db.execute(sql`
        SELECT * FROM attendance_reward_tiers WHERE program_id = ${programId} ORDER BY visit_count ASC
      `));
      const qr = row0(await db.execute(sql`
        SELECT * FROM attendance_qr_codes WHERE program_id = ${programId}
      `));
      const prog = row0(await db.execute(sql`
        SELECT name, slug, organization_id FROM athletic_programs WHERE id = ${programId}
      `));
      res.json({ config, fields, rewards, qr, program: prog });
    } catch (e) {
      console.error("[attendance-programs config]", e);
      res.status(500).json({ error: "Failed" });
    }
  });

  // ─── Upsert attendance program config ────────────────────────────────────
  app.post("/api/attendance-programs/:programId/config", async (req, res) => {
    try {
      const { programId } = req.params;
      const { description, location, startDate, endDate, active, organizationId } = req.body;

      const existing = row0(await db.execute(sql`
        SELECT id FROM attendance_programs WHERE program_id = ${programId}
      `));

      if (existing) {
        await db.execute(sql`
          UPDATE attendance_programs SET
            description = ${description ?? null},
            location = ${location ?? null},
            start_date = ${startDate ?? null},
            end_date = ${endDate ?? null},
            active = ${active ?? true},
            updated_at = NOW()
          WHERE program_id = ${programId}
        `);
      } else {
        await db.execute(sql`
          INSERT INTO attendance_programs (organization_id, program_id, description, location, start_date, end_date, active)
          VALUES (${organizationId}, ${programId}, ${description ?? null}, ${location ?? null}, ${startDate ?? null}, ${endDate ?? null}, ${active ?? true})
        `);
      }

      // Ensure QR code exists
      const slug = row0(await db.execute(sql`
        SELECT slug, organization_id FROM athletic_programs WHERE id = ${programId}
      `));
      if (slug) {
        const existingQr = row0(await db.execute(sql`
          SELECT id FROM attendance_qr_codes WHERE program_id = ${programId}
        `));
        if (!existingQr) {
          await db.execute(sql`
            INSERT INTO attendance_qr_codes (organization_id, program_id, public_slug)
            VALUES (${slug.organization_id}, ${programId}, ${slug.slug})
            ON CONFLICT (program_id) DO NOTHING
          `);
        }
      }

      res.json({ ok: true });
    } catch (e) {
      console.error("[attendance-programs upsert]", e);
      res.status(500).json({ error: "Failed" });
    }
  });

  // ─── Update fields ────────────────────────────────────────────────────────
  app.put("/api/attendance-programs/:programId/fields", async (req, res) => {
    try {
      const { programId } = req.params;
      const { fields } = req.body;
      if (!Array.isArray(fields)) return res.status(400).json({ error: "fields must be an array" });

      // Always resolve orgId from the program — never trust the request body
      const prog = row0(await db.execute(sql`
        SELECT organization_id FROM athletic_programs WHERE id = ${programId}
      `));
      if (!prog) return res.status(404).json({ error: "Program not found" });
      const organizationId = prog.organization_id;

      await db.execute(sql`DELETE FROM attendance_program_fields WHERE program_id = ${programId}`);
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        await db.execute(sql`
          INSERT INTO attendance_program_fields (organization_id, program_id, field_name, label, field_type, visibility, display_order)
          VALUES (${organizationId}, ${programId}, ${f.fieldName}, ${f.label}, ${f.fieldType || "text"}, ${f.visibility || "required"}, ${i})
        `);
      }

      const saved = rows(await db.execute(sql`
        SELECT * FROM attendance_program_fields WHERE program_id = ${programId} ORDER BY display_order ASC
      `));
      res.json({ ok: true, fields: saved });
    } catch (e) {
      console.error("[attendance fields]", e);
      res.status(500).json({ error: "Failed to save fields" });
    }
  });

  // ─── Update reward tiers ──────────────────────────────────────────────────
  app.put("/api/attendance-programs/:programId/rewards", async (req, res) => {
    try {
      const { programId } = req.params;
      const { tiers } = req.body;
      if (!Array.isArray(tiers)) return res.status(400).json({ error: "tiers must be an array" });

      // Always resolve orgId from the program — never trust the request body
      const prog = row0(await db.execute(sql`
        SELECT organization_id FROM athletic_programs WHERE id = ${programId}
      `));
      if (!prog) return res.status(404).json({ error: "Program not found" });
      const organizationId = prog.organization_id;

      await db.execute(sql`DELETE FROM attendance_reward_tiers WHERE program_id = ${programId}`);
      for (const t of tiers) {
        await db.execute(sql`
          INSERT INTO attendance_reward_tiers (organization_id, program_id, visit_count, reward_name, reward_description, active)
          VALUES (${organizationId}, ${programId}, ${Number(t.visitCount)}, ${t.rewardName}, ${t.rewardDescription ?? null}, ${t.active ?? true})
        `);
      }

      const saved = rows(await db.execute(sql`
        SELECT * FROM attendance_reward_tiers WHERE program_id = ${programId} ORDER BY visit_count ASC
      `));
      res.json({ ok: true, tiers: saved });
    } catch (e) {
      console.error("[attendance rewards]", e);
      res.status(500).json({ error: "Failed to save rewards" });
    }
  });

  // ─── Public: get check-in page data by slug (no auth required) ───────────
  app.get("/api/attendance/checkin/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const qr = row0(await db.execute(sql`
        SELECT * FROM attendance_qr_codes WHERE public_slug = ${slug}
      `));
      if (!qr) return res.status(404).json({ error: "Program not found" });

      const prog = row0(await db.execute(sql`
        SELECT name, slug FROM athletic_programs WHERE id = ${qr.program_id}
      `));
      const config = row0(await db.execute(sql`
        SELECT * FROM attendance_programs WHERE program_id = ${qr.program_id}
      `));
      if (config && !config.active) return res.status(404).json({ error: "Program is not active" });

      let fields = rows(await db.execute(sql`
        SELECT * FROM attendance_program_fields WHERE program_id = ${qr.program_id} AND visibility != 'hidden' ORDER BY display_order ASC
      `));

      // If no field config has been saved yet, return sensible defaults so
      // the check-in form always has at least name + email visible.
      if (fields.length === 0) {
        fields = [
          { id: "default-0", field_name: "first_name", label: "First Name", field_type: "text", visibility: "required", display_order: 0 },
          { id: "default-1", field_name: "last_name",  label: "Last Name",  field_type: "text", visibility: "required", display_order: 1 },
          { id: "default-2", field_name: "email",      label: "Email",      field_type: "email", visibility: "required", display_order: 2 },
          { id: "default-3", field_name: "phone",      label: "Phone",      field_type: "phone", visibility: "optional", display_order: 3 },
          { id: "default-4", field_name: "sport",      label: "Sport",      field_type: "text",  visibility: "optional", display_order: 4 },
        ];
      }

      const rewards = rows(await db.execute(sql`
        SELECT * FROM attendance_reward_tiers WHERE program_id = ${qr.program_id} AND active = true ORDER BY visit_count ASC
      `));
      const orgBranding = await getOrgBrandingForAttendance(qr.organization_id);

      res.json({ program: prog, config, fields, rewards, orgBranding, programId: qr.program_id, organizationId: qr.organization_id });
    } catch (e) {
      console.error("[checkin page]", e);
      res.status(500).json({ error: "Failed" });
    }
  });

  // ─── Public: submit attendance (no auth required) ─────────────────────────
  app.post("/api/attendance/checkin/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const qr = row0(await db.execute(sql`
        SELECT * FROM attendance_qr_codes WHERE public_slug = ${slug}
      `));
      if (!qr) return res.status(404).json({ error: "Program not found" });

      const { firstName, lastName, email, phone, sport, position, school, gradYear, team, age, extraFields } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required" });

      const normalizedEmail = email.toLowerCase().trim();
      const programId = qr.program_id;
      const orgId = qr.organization_id;

      // Count existing visits for this email+program
      const existingVisits = row0(await db.execute(sql`
        SELECT COUNT(*) as count FROM attendance_records
        WHERE program_id = ${programId} AND athlete_email = ${normalizedEmail}
      `));
      const visitNumber = Number(existingVisits?.count ?? 0) + 1;

      // Insert attendance record
      await db.execute(sql`
        INSERT INTO attendance_records (organization_id, program_id, athlete_email, athlete_first_name, athlete_last_name, phone, sport, position, school, grad_year, team, age, extra_fields, visit_number, ip_address)
        VALUES (${orgId}, ${programId}, ${normalizedEmail}, ${firstName ?? null}, ${lastName ?? null}, ${phone ?? null}, ${sport ?? null}, ${position ?? null}, ${school ?? null}, ${gradYear ?? null}, ${team ?? null}, ${age ?? null}, ${JSON.stringify(extraFields ?? {})}, ${visitNumber}, ${req.ip ?? null})
      `);

      // Upsert into lead capture submissions (lead integration)
      try {
        const athleteName = [firstName, lastName].filter(Boolean).join(" ") || normalizedEmail;
        const existingLead = row0(await db.execute(sql`
          SELECT id FROM lead_capture_submissions WHERE email = ${normalizedEmail} AND org_id = ${orgId}
          ORDER BY created_at DESC LIMIT 1
        `));
        if (!existingLead) {
          await db.execute(sql`
            INSERT INTO lead_capture_submissions (org_id, program_id, athlete_name, email, phone, sport, position, school, grade, sequence_status)
            VALUES (${orgId}, ${programId}, ${athleteName}, ${normalizedEmail}, ${phone ?? null}, ${sport ?? null}, ${position ?? null}, ${school ?? null}, ${gradYear ?? null}, 'pending')
          `);
        }
      } catch (leadErr) {
        console.error("[Attendance] Lead upsert error:", leadErr);
      }

      // Get reward tiers
      const tiers = rows(await db.execute(sql`
        SELECT * FROM attendance_reward_tiers WHERE program_id = ${programId} AND active = true ORDER BY visit_count ASC
      `));

      const org = await getOrgBrandingForAttendance(orgId);
      const prog = row0(await db.execute(sql`SELECT name FROM athletic_programs WHERE id = ${programId}`));
      const progName = prog?.name || "Training Program";

      // Check newly earned rewards (exact match on this visit)
      const newlyEarned = tiers.filter(t => t.visit_count === visitNumber);
      for (const tier of newlyEarned) {
        const alreadyEarned = row0(await db.execute(sql`
          SELECT id FROM attendance_rewards_earned WHERE program_id = ${programId} AND athlete_email = ${normalizedEmail} AND tier_id = ${tier.id}
        `));
        if (!alreadyEarned) {
          await db.execute(sql`
            INSERT INTO attendance_rewards_earned (organization_id, program_id, tier_id, athlete_email, visit_count_at_earned, notification_sent_at)
            VALUES (${orgId}, ${programId}, ${tier.id}, ${normalizedEmail}, ${visitNumber}, NOW())
          `);
          await sendAttendanceEmail({
            orgId, programId, athleteEmail: normalizedEmail, athleteFirstName: firstName || "",
            orgName: org.name, orgColor: org.color, visitCount: visitNumber,
            rewardTiers: tiers, programName: progName, emailType: "reward_earned", rewardName: tier.reward_name,
          });
        }
      }

      // If no reward earned this visit, send confirmation email & check approaching reward (2 away)
      if (newlyEarned.length === 0) {
        const nextReward = tiers.find(t => t.visit_count > visitNumber);
        const visitsAway = nextReward ? nextReward.visit_count - visitNumber : null;

        if (visitsAway === 2 && nextReward) {
          await sendAttendanceEmail({
            orgId, programId, athleteEmail: normalizedEmail, athleteFirstName: firstName || "",
            orgName: org.name, orgColor: org.color, visitCount: visitNumber,
            rewardTiers: tiers, programName: progName, emailType: "reward_approaching",
            rewardName: nextReward.reward_name, visitsAway,
          });
        } else {
          await sendAttendanceEmail({
            orgId, programId, athleteEmail: normalizedEmail, athleteFirstName: firstName || "",
            orgName: org.name, orgColor: org.color, visitCount: visitNumber,
            rewardTiers: tiers, programName: progName, emailType: "confirmation",
          });
        }
      }

      // Compute reward progress for response
      const nextReward = tiers.find(t => t.visit_count > visitNumber);
      const rewardsEarned = tiers.filter(t => t.visit_count <= visitNumber);

      res.json({
        ok: true,
        visitNumber,
        nextReward: nextReward || null,
        rewardsEarned,
        visitsToNext: nextReward ? nextReward.visit_count - visitNumber : null,
      });
    } catch (e) {
      console.error("[attendance submit]", e);
      res.status(500).json({ error: "Failed to record attendance" });
    }
  });

  // ─── Admin: list attendance records with filters ──────────────────────────
  app.get("/api/attendance/dashboard", async (req, res) => {
    try {
      const { orgId, programId, sport, view = "all" } = req.query as Record<string, string>;
      if (!orgId) return res.status(400).json({ error: "orgId required" });

      // Build date filter based on view
      let dateFilter = sql``;
      const now = new Date();
      if (view === "day") {
        dateFilter = sql`AND DATE(ar.created_at) = CURRENT_DATE`;
      } else if (view === "week") {
        dateFilter = sql`AND ar.created_at >= date_trunc('week', NOW())`;
      } else if (view === "month") {
        dateFilter = sql`AND ar.created_at >= date_trunc('month', NOW())`;
      } else if (view === "year") {
        dateFilter = sql`AND ar.created_at >= date_trunc('year', NOW())`;
      }

      const programFilter = programId ? sql`AND ar.program_id = ${programId}` : sql``;
      const sportFilter = sport ? sql`AND ar.sport = ${sport}` : sql``;

      // Get athlete summaries
      const athletes = rows(await db.execute(sql`
        SELECT
          ar.athlete_email,
          MAX(ar.athlete_first_name) AS first_name,
          MAX(ar.athlete_last_name) AS last_name,
          MAX(ar.sport) AS sport,
          MAX(ar.position) AS position,
          MAX(ar.school) AS school,
          MAX(ar.visit_number) AS total_visits,
          MAX(ar.created_at) AS last_visit,
          COUNT(*) FILTER (WHERE DATE(ar.created_at) = CURRENT_DATE) AS visits_today
        FROM attendance_records ar
        WHERE ar.organization_id = ${orgId}
          ${dateFilter}
          ${programFilter}
          ${sportFilter}
        GROUP BY ar.athlete_email
        ORDER BY MAX(ar.created_at) DESC
        LIMIT 200
      `));

      // Get rewards earned per athlete
      const rewards = rows(await db.execute(sql`
        SELECT are.athlete_email, array_agg(art.reward_name) AS rewards
        FROM attendance_rewards_earned are
        JOIN attendance_reward_tiers art ON art.id = are.tier_id
        WHERE are.organization_id = ${orgId}
        GROUP BY are.athlete_email
      `));
      const rewardsMap: Record<string, string[]> = {};
      for (const r of rewards) {
        rewardsMap[r.athlete_email] = r.rewards || [];
      }

      // Get next reward for each athlete
      const tiers = rows(await db.execute(sql`
        SELECT * FROM attendance_reward_tiers
        WHERE organization_id = ${orgId} AND active = true
        ${programId ? sql`AND program_id = ${programId}` : sql``}
        ORDER BY visit_count ASC
      `));

      const athletesWithProgress = athletes.map((a: any) => {
        const totalVisits = Number(a.total_visits || 0);
        const nextReward = tiers.find(t => Number(t.visit_count) > totalVisits);
        const earned = rewardsMap[a.athlete_email] || [];
        return {
          email: a.athlete_email,
          firstName: a.first_name || "",
          lastName: a.last_name || "",
          name: [a.first_name, a.last_name].filter(Boolean).join(" ") || a.athlete_email,
          sport: a.sport || "",
          position: a.position || "",
          school: a.school || "",
          totalVisits,
          lastVisit: a.last_visit,
          rewardProgress: nextReward ? `${totalVisits}/${nextReward.visit_count}` : "Complete",
          nextRewardName: nextReward?.reward_name || null,
          rewardsEarned: earned,
        };
      });

      res.json({ athletes: athletesWithProgress, total: athletesWithProgress.length });
    } catch (e) {
      console.error("[attendance dashboard]", e);
      res.status(500).json({ error: "Failed" });
    }
  });

  // ─── Admin: analytics ─────────────────────────────────────────────────────
  app.get("/api/attendance/analytics", async (req, res) => {
    try {
      const { orgId, programId } = req.query as Record<string, string>;
      if (!orgId) return res.status(400).json({ error: "orgId required" });

      const pFilter = programId ? sql`AND program_id = ${programId}` : sql``;

      const totals = row0(await db.execute(sql`
        SELECT
          COUNT(*) AS total_checkins,
          COUNT(DISTINCT athlete_email) AS unique_athletes
        FROM attendance_records
        WHERE organization_id = ${orgId} ${pFilter}
      `));

      const returning = row0(await db.execute(sql`
        SELECT COUNT(DISTINCT athlete_email) AS returning_athletes
        FROM attendance_records
        WHERE organization_id = ${orgId} ${pFilter}
        GROUP BY athlete_email HAVING COUNT(*) > 1
        -- this query is wrong, fix with subquery
      `));

      const returningFixed = row0(await db.execute(sql`
        SELECT COUNT(*) AS returning_athletes FROM (
          SELECT athlete_email FROM attendance_records
          WHERE organization_id = ${orgId} ${pFilter}
          GROUP BY athlete_email HAVING COUNT(*) > 1
        ) sub
      `));

      const avgVisits = row0(await db.execute(sql`
        SELECT ROUND(AVG(visit_count)::numeric, 1) AS avg_visits FROM (
          SELECT athlete_email, COUNT(*) AS visit_count FROM attendance_records
          WHERE organization_id = ${orgId} ${pFilter}
          GROUP BY athlete_email
        ) sub
      `));

      const rewardEarned = row0(await db.execute(sql`
        SELECT COUNT(*) AS earned FROM attendance_rewards_earned
        WHERE organization_id = ${orgId} ${pFilter}
      `));

      const totalTierSlots = row0(await db.execute(sql`
        SELECT COUNT(*) AS total FROM attendance_reward_tiers
        WHERE organization_id = ${orgId} AND active = true ${pFilter}
      `));

      // Attendance over time (last 30 days)
      const overTime = rows(await db.execute(sql`
        SELECT DATE(created_at) AS date, COUNT(*) AS checkins
        FROM attendance_records
        WHERE organization_id = ${orgId} ${pFilter}
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `));

      // Top sports
      const topSports = rows(await db.execute(sql`
        SELECT sport, COUNT(*) AS count FROM attendance_records
        WHERE organization_id = ${orgId} ${pFilter} AND sport IS NOT NULL
        GROUP BY sport ORDER BY count DESC LIMIT 8
      `));

      // Top programs
      const topPrograms = rows(await db.execute(sql`
        SELECT ap.name, COUNT(*) AS checkins
        FROM attendance_records ar
        JOIN athletic_programs ap ON ap.id = ar.program_id
        WHERE ar.organization_id = ${orgId}
        GROUP BY ap.name ORDER BY checkins DESC LIMIT 8
      `));

      // Growth %: compare this month to last month
      const growth = row0(await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW())) AS this_month,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()) - INTERVAL '1 month'
            AND created_at < date_trunc('month', NOW())) AS last_month
        FROM attendance_records
        WHERE organization_id = ${orgId} ${pFilter}
      `));

      const thisMonth = Number(growth?.this_month || 0);
      const lastMonth = Number(growth?.last_month || 0);
      const growthPct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : (thisMonth > 0 ? 100 : 0);

      // Today / week / month breakdown
      const periodCounts = row0(await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) AS today,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('week', NOW())) AS this_week,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW())) AS this_month
        FROM attendance_records
        WHERE organization_id = ${orgId} ${pFilter}
      `));

      res.json({
        totalCheckIns: Number(totals?.total_checkins || 0),
        uniqueAthletes: Number(totals?.unique_athletes || 0),
        returningAthletes: Number(returningFixed?.returning_athletes || 0),
        avgVisitsPerAthlete: Number(avgVisits?.avg_visits || 0),
        rewardsEarned: Number(rewardEarned?.earned || 0),
        rewardRedemptionRate: totalTierSlots?.total > 0
          ? Math.round((Number(rewardEarned?.earned || 0) / Number(totalTierSlots.total)) * 100)
          : 0,
        attendanceGrowthPct: growthPct,
        todayCheckIns: Number(periodCounts?.today || 0),
        weekCheckIns: Number(periodCounts?.this_week || 0),
        monthCheckIns: Number(periodCounts?.this_month || 0),
        overTime: overTime.map(r => ({ date: r.date, checkins: Number(r.checkins) })),
        topSports: topSports.map(r => ({ sport: r.sport, count: Number(r.count) })),
        topPrograms: topPrograms.map(r => ({ name: r.name, checkins: Number(r.checkins) })),
      });
    } catch (e) {
      console.error("[attendance analytics]", e);
      res.status(500).json({ error: "Failed" });
    }
  });

  // ─── Admin: athlete visit history ─────────────────────────────────────────
  app.get("/api/attendance/athlete-history", async (req, res) => {
    try {
      const { orgId, email } = req.query as Record<string, string>;
      if (!orgId || !email) return res.status(400).json({ error: "orgId and email required" });

      const records = rows(await db.execute(sql`
        SELECT ar.*, ap.name AS program_name
        FROM attendance_records ar
        JOIN athletic_programs ap ON ap.id = ar.program_id
        WHERE ar.organization_id = ${orgId} AND ar.athlete_email = ${email}
        ORDER BY ar.created_at DESC
      `));

      const earned = rows(await db.execute(sql`
        SELECT are.*, art.reward_name, art.visit_count
        FROM attendance_rewards_earned are
        JOIN attendance_reward_tiers art ON art.id = are.tier_id
        WHERE are.organization_id = ${orgId} AND are.athlete_email = ${email}
        ORDER BY are.created_at DESC
      `));

      res.json({ records, rewardsEarned: earned, totalVisits: records.length });
    } catch (e) {
      console.error("[athlete history]", e);
      res.status(500).json({ error: "Failed" });
    }
  });

  // ─── Admin: list programs for org ─────────────────────────────────────────
  app.get("/api/attendance/programs", async (req, res) => {
    try {
      const { orgId } = req.query as Record<string, string>;
      if (!orgId) return res.status(400).json({ error: "orgId required" });

      // Debug: check what types exist for this org
      const allTypes = rows(await db.execute(sql`
        SELECT type, COUNT(*) AS cnt FROM athletic_programs
        WHERE organization_id = ${orgId}
        GROUP BY type ORDER BY cnt DESC
      `));
      console.log(`[AttendancePrograms] orgId=${orgId} types:`, JSON.stringify(allTypes));

      const programs = rows(await db.execute(sql`
        SELECT ap.*, atp.active AS tracker_active, atp.location, atp.description,
               aqr.public_slug
        FROM athletic_programs ap
        LEFT JOIN attendance_programs atp ON atp.program_id = ap.id
        LEFT JOIN attendance_qr_codes aqr ON aqr.program_id = ap.id
        WHERE ap.organization_id = ${orgId} AND ap.type = 'attendance_tracker'
        ORDER BY ap.created_at DESC
      `));
      console.log(`[AttendancePrograms] found ${programs.length} attendance_tracker programs, ids:`, programs.map((p: any) => p.id));
      res.json(programs);
    } catch (e) {
      console.error("[attendance programs list]", e);
      res.status(500).json({ error: "Failed" });
    }
  });

  // ─── Coach report recipients: GET ────────────────────────────────────────
  app.get("/api/attendance-programs/:programId/report-recipients", async (req, res) => {
    try {
      const { programId } = req.params;
      const recipients = rows(await db.execute(sql`
        SELECT id, org_id, attendance_program_id, coach_id, email, name,
               receive_daily, receive_weekly, active, created_at, updated_at
        FROM attendance_report_recipients
        WHERE attendance_program_id = ${programId}
        ORDER BY created_at ASC
      `));
      const history = rows(await db.execute(sql`
        SELECT recipient_email, report_type, period_start, sent_at, status
        FROM attendance_report_email_history
        WHERE attendance_program_id = ${programId}
        ORDER BY sent_at DESC
        LIMIT 50
      `));
      const lastSent: Record<string, any> = {};
      for (const h of history) {
        const key = `${h.recipient_email}:${h.report_type}`;
        if (!lastSent[key]) lastSent[key] = h;
      }
      const recipientsWithHistory = recipients.map((r: any) => ({
        ...r,
        lastDailySent: lastSent[`${r.email}:daily`] || null,
        lastWeeklySent: lastSent[`${r.email}:weekly`] || null,
      }));
      res.json({ recipients: recipientsWithHistory });
    } catch (e) {
      console.error("[report-recipients GET]", e);
      res.status(500).json({ error: "Failed" });
    }
  });

  // ─── Coach report recipients: PUT (full replace) ──────────────────────────
  app.put("/api/attendance-programs/:programId/report-recipients", async (req, res) => {
    try {
      const { programId } = req.params;
      const { recipients, orgId } = req.body as {
        recipients: Array<{ coachId?: string; email: string; name: string; receiveDaily: boolean; receiveWeekly: boolean; active: boolean }>;
        orgId: string;
      };
      if (!orgId) return res.status(400).json({ error: "orgId required" });

      const incomingEmails = (recipients || []).map(r => r.email);
      if (incomingEmails.length > 0) {
        for (const email of incomingEmails) {
          // will delete below via NOT IN workaround (use delete+insert approach)
          void email;
        }
        // Delete rows whose email is NOT in the incoming list
        const existingRows = rows(await db.execute(sql`
          SELECT email FROM attendance_report_recipients WHERE attendance_program_id = ${programId}
        `));
        for (const ex of existingRows) {
          if (!incomingEmails.includes(ex.email)) {
            await db.execute(sql`
              DELETE FROM attendance_report_recipients
              WHERE attendance_program_id = ${programId} AND email = ${ex.email}
            `);
          }
        }
      } else {
        await db.execute(sql`
          DELETE FROM attendance_report_recipients WHERE attendance_program_id = ${programId}
        `);
      }

      for (const r of (recipients || [])) {
        await db.execute(sql`
          INSERT INTO attendance_report_recipients
            (org_id, attendance_program_id, coach_id, email, name, receive_daily, receive_weekly, active, updated_at)
          VALUES (${orgId}, ${programId}, ${r.coachId ?? null}, ${r.email}, ${r.name},
                  ${r.receiveDaily}, ${r.receiveWeekly}, ${r.active}, NOW())
          ON CONFLICT (attendance_program_id, email) DO UPDATE SET
            name = EXCLUDED.name,
            coach_id = EXCLUDED.coach_id,
            receive_daily = EXCLUDED.receive_daily,
            receive_weekly = EXCLUDED.receive_weekly,
            active = EXCLUDED.active,
            updated_at = NOW()
        `);
      }

      const saved = rows(await db.execute(sql`
        SELECT * FROM attendance_report_recipients
        WHERE attendance_program_id = ${programId} ORDER BY created_at ASC
      `));
      res.json({ ok: true, recipients: saved });
    } catch (e) {
      console.error("[report-recipients PUT]", e);
      res.status(500).json({ error: "Failed" });
    }
  });

  // ─── Send test report ─────────────────────────────────────────────────────
  app.post("/api/attendance-programs/:programId/report-recipients/send-test", async (req, res) => {
    try {
      const { programId } = req.params;
      const { recipientEmail, reportType = "daily" } = req.body;
      if (!recipientEmail) return res.status(400).json({ error: "recipientEmail required" });
      const { sendTestReport } = await import("./attendance-report-cron");
      const result = await sendTestReport(programId, recipientEmail, reportType);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed" });
    }
  });

  console.log("[Attendance] Routes registered");
}
