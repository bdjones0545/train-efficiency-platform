/**
 * Opportunity Discovery Agent — Phase 5
 * Pluggable adapter architecture for discovering coaching/consulting opportunities
 * from multiple sources. Handles filtering, deduplication, and DB persistence.
 * No outreach, no auto-qualification, no email sending.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscoveredOpportunity {
  title:          string;
  company?:       string;
  location?:      string;
  source:         string;
  remoteType?:    "remote" | "hybrid" | "local";
  description?:   string;
  applyUrl?:      string;
  estimatedValue?: number;
}

export interface OpportunitySourceAdapter {
  name: string;
  discover(): Promise<DiscoveredOpportunity[]>;
}

export interface DiscoveryRunResult {
  runId:      string;
  scanned:    number;
  created:    number;
  rejected:   number;
  duplicates: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}
function row0(result: unknown): any {
  return rows(result)[0] ?? null;
}

/**
 * Deterministic djb2 fingerprint. Used for deduplication.
 */
function fingerprint(title: string, company = "", location = ""): string {
  const s = [title, company, location]
    .map(v => v.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .join(":");
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

// ─── Positive / Negative signal lists ────────────────────────────────────────

const POSITIVE_SIGNALS = [
  "remote", "online", "virtual", "coach", "coaching", "trainer", "training",
  "performance", "strength", "conditioning", "wellness", "consultant",
  "consulting", "programming", "athletic", "athlete", "sports science",
  "nutrition", "exercise", "fitness", "biomechanics",
];

const NEGATIVE_SIGNALS = [
  "onsite only", "relocation required", "field technician", "travel required",
  "warehouse", "delivery", "forklift", "construction", "manufacturing",
  "retail associate", "cashier",
];

function passesFilter(opp: DiscoveredOpportunity): boolean {
  const text = `${opp.title} ${opp.description ?? ""} ${opp.location ?? ""}`.toLowerCase();

  // Hard reject on any negative signal
  for (const neg of NEGATIVE_SIGNALS) {
    if (text.includes(neg)) return false;
  }

  // Must have at least one positive signal
  return POSITIVE_SIGNALS.some(pos => text.includes(pos));
}

// ─── Mock Source Adapters ─────────────────────────────────────────────────────
// Each adapter is isolated and can be replaced with a real integration.

class LinkedInAdapter implements OpportunitySourceAdapter {
  name = "LinkedIn Jobs";
  async discover(): Promise<DiscoveredOpportunity[]> {
    return [
      {
        title: "Remote Strength & Conditioning Coach",
        company: "Elite Performance Academy",
        location: "Remote",
        source: this.name,
        remoteType: "remote",
        description: "Seeking an experienced S&C coach to design and deliver online programming for our remote athlete roster. Includes progress tracking, exercise modifications, and virtual check-ins.",
        estimatedValue: 70000,
      },
      {
        title: "Online Athletic Programming Specialist",
        company: "ProSport Systems",
        location: "Remote / US",
        source: this.name,
        remoteType: "remote",
        description: "Build and manage evidence-based training programs for a growing online coaching platform. Must be comfortable with digital tools and remote athlete communication.",
        estimatedValue: 58000,
      },
      {
        title: "Virtual Wellness & Performance Coach",
        company: "Corporate Wellness Partners",
        location: "Remote",
        source: this.name,
        remoteType: "remote",
        description: "Design holistic wellness programming for corporate clients. Remote delivery — Zoom-based sessions, app-guided workouts, and monthly health reporting.",
        estimatedValue: 72000,
      },
      {
        title: "Field Technician — Sports Equipment Repair",
        company: "SportGear Service Inc",
        location: "Onsite — Multiple Locations",
        source: this.name,
        remoteType: "local",
        description: "Travel required. Repair and maintain sports equipment at gym locations across the region. Forklift certification preferred.",
        estimatedValue: 40000,
      },
      {
        title: "Remote Sports Performance Consultant",
        company: "Peak Performance LLC",
        location: "Remote — Anywhere",
        source: this.name,
        remoteType: "remote",
        description: "Contract consulting role. Provide performance programming and coaching support for 6–10 remote clients monthly. Flexible hours. Ideal for coaches building a consulting practice.",
        estimatedValue: 85000,
      },
      {
        title: "Strength & Conditioning Program Designer",
        company: "FitTech Innovations",
        location: "Remote",
        source: this.name,
        remoteType: "remote",
        description: "Create AI-assisted workout templates and coach-delivered programming for a SaaS fitness platform. Strong S&C background required.",
        estimatedValue: 64000,
      },
    ];
  }
}

class IndeedAdapter implements OpportunitySourceAdapter {
  name = "Indeed";
  async discover(): Promise<DiscoveredOpportunity[]> {
    return [
      {
        title: "Strength Training Program Designer",
        company: "Online Athlete Academy",
        location: "Remote",
        source: this.name,
        remoteType: "remote",
        description: "We need a strength training expert to design 8–12 week programs for our online coaching platform. Work fully remote. Athletes range from high school to collegiate level.",
        estimatedValue: 60000,
      },
      {
        title: "Warehouse Associate — Athletic Apparel Distribution",
        company: "Sports Direct USA",
        location: "Phoenix, AZ — Onsite Only",
        source: this.name,
        remoteType: "local",
        description: "Full-time warehouse associate for our distribution center. Lifting up to 50lbs. No remote option. Relocation required if outside metro.",
        estimatedValue: 36000,
      },
      {
        title: "Virtual S&C Coach for College Athletes",
        company: "Collegiate Performance Hub",
        location: "Remote",
        source: this.name,
        remoteType: "remote",
        description: "Deliver virtual strength and conditioning coaching sessions for NCAA Division II athletes. Programming, video review, and athlete education included.",
        estimatedValue: 58000,
      },
      {
        title: "Remote Athletic Performance Coach",
        company: "TechFit Solutions",
        location: "100% Remote",
        source: this.name,
        remoteType: "remote",
        description: "Join a technology-forward coaching company delivering virtual athletic performance services. Duties include program design, athlete check-ins, and reporting dashboards.",
        estimatedValue: 74000,
      },
      {
        title: "Online Fitness & Nutrition Consultant",
        company: "WellnessOS Inc",
        location: "Remote",
        source: this.name,
        remoteType: "remote",
        description: "Provide combined fitness and nutrition programming to online clients. Certified nutrition background preferred. Fully remote, flexible schedule.",
        estimatedValue: 55000,
      },
    ];
  }
}

class TeamWorkOnlineAdapter implements OpportunitySourceAdapter {
  name = "TeamWork Online";
  async discover(): Promise<DiscoveredOpportunity[]> {
    return [
      {
        title: "Head Strength & Conditioning Coordinator",
        company: "State University Athletics",
        location: "On-site — Campus Required",
        source: this.name,
        remoteType: "local",
        description: "Lead all strength and conditioning programming for our varsity athletic department. Full-time, on-campus role. Requires CSCS certification.",
        estimatedValue: 68000,
      },
      {
        title: "Remote Athletic Development Specialist",
        company: "ProAthletics Online",
        location: "Remote",
        source: this.name,
        remoteType: "remote",
        description: "Online coaching platform seeking an athletic development specialist to create progressive programming plans and coach athletes via app-based tools.",
        estimatedValue: 56000,
      },
      {
        title: "Performance Coaching & Programming Lead",
        company: "Sports Science Institute",
        location: "Hybrid — 2 days onsite",
        source: this.name,
        remoteType: "hybrid",
        description: "Lead programming for a hybrid coaching model. Design evidence-based S&C programs and mentor junior coaches. Mix of remote and in-person work.",
        estimatedValue: 69000,
      },
      {
        title: "Remote Sports Technology Consultant",
        company: "AthleteTech Group",
        location: "Remote",
        source: this.name,
        remoteType: "remote",
        description: "Consulting role for a sports technology company. Advise on strength and conditioning programming standards, athlete data models, and performance benchmarks.",
        estimatedValue: 90000,
      },
    ];
  }
}

class HigherEdJobsAdapter implements OpportunitySourceAdapter {
  name = "HigherEdJobs";
  async discover(): Promise<DiscoveredOpportunity[]> {
    return [
      {
        title: "Online Performance Education Specialist",
        company: "Sports Education Institute",
        location: "Remote",
        source: this.name,
        remoteType: "remote",
        description: "Develop and deliver online performance education curriculum for coaches and athletes. Remote-first role. Background in sport science or kinesiology preferred.",
        estimatedValue: 63000,
      },
      {
        title: "Virtual Athletic Performance Consultant",
        company: "University Extension Program",
        location: "Remote — Contract",
        source: this.name,
        remoteType: "remote",
        description: "Contract consultant to support online athlete education programming for a university extension. Flexible engagement, 10–20 hrs/week.",
        estimatedValue: 50000,
      },
      {
        title: "Strength & Conditioning Programming Director",
        company: "National Training Center Online",
        location: "Remote",
        source: this.name,
        remoteType: "remote",
        description: "Direct all online S&C programming for a national coaching platform. Oversee a team of 4 remote coaches, establish quality standards, and build athlete success systems.",
        estimatedValue: 95000,
      },
      {
        title: "Exercise Science & Wellness Program Coordinator",
        company: "Graduate Health Institute",
        location: "Hybrid",
        source: this.name,
        remoteType: "hybrid",
        description: "Coordinate exercise science and wellness programming for graduate students and faculty. Mix of in-person classes and virtual coaching sessions.",
        estimatedValue: 57000,
      },
    ];
  }
}

class NCAAAdapter implements OpportunitySourceAdapter {
  name = "NCAA Careers";
  async discover(): Promise<DiscoveredOpportunity[]> {
    return [
      {
        title: "Remote Athletic Performance Analyst",
        company: "NCAA Member Institution",
        location: "Remote",
        source: this.name,
        remoteType: "remote",
        description: "Analyze athletic performance data, build conditioning benchmarks, and deliver programming recommendations to coaching staff. Full remote position.",
        estimatedValue: 56000,
      },
      {
        title: "Strength & Conditioning Consultant — Technology Integration",
        company: "Sports Analytics Partners",
        location: "Remote",
        source: this.name,
        remoteType: "remote",
        description: "Consulting opportunity for a sports analytics firm. Advise on S&C protocol design and help integrate wearable technology data into conditioning programs. Remote.",
        estimatedValue: 78000,
      },
      {
        title: "Travel-Required Performance Coach",
        company: "National Pro Team",
        location: "Onsite — Travel Required",
        source: this.name,
        remoteType: "local",
        description: "Join our coaching staff as a performance coach. Extensive travel required for games and training camps. Relocation required to team city.",
        estimatedValue: 80000,
      },
    ];
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const ALL_ADAPTERS: Record<string, () => OpportunitySourceAdapter> = {
  linkedin:       () => new LinkedInAdapter(),
  indeed:         () => new IndeedAdapter(),
  teamworkOnline: () => new TeamWorkOnlineAdapter(),
  higherEdJobs:   () => new HigherEdJobsAdapter(),
  ncaaCareers:    () => new NCAAAdapter(),
};

// ─── DB bootstrap ─────────────────────────────────────────────────────────────

async function ensureDiscoveryRunsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_discovery_runs (
      id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id                TEXT NOT NULL,
      started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at          TIMESTAMPTZ,
      status                TEXT NOT NULL DEFAULT 'running',
      opportunities_scanned INTEGER NOT NULL DEFAULT 0,
      opportunities_created INTEGER NOT NULL DEFAULT 0,
      opportunities_rejected INTEGER NOT NULL DEFAULT 0,
      duplicates_skipped    INTEGER NOT NULL DEFAULT 0,
      notes                 TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Add fingerprint column to opportunities table for dedup
  await db.execute(sql`
    ALTER TABLE opportunity_acquisition_opportunities
      ADD COLUMN IF NOT EXISTS fingerprint TEXT
  `);
}

// ─── Main Discovery Function ──────────────────────────────────────────────────

export async function runOpportunityDiscovery(
  orgId: string,
  enabledSources?: string[],
): Promise<DiscoveryRunResult> {
  await ensureDiscoveryRunsTable();

  // Fetch org settings to determine which sources are active
  const settingsRow = row0(await db.execute(sql`
    SELECT sources, qual_rules FROM opportunity_source_settings WHERE org_id = ${orgId}
  `));

  const sourcesConfig: Record<string, boolean> = settingsRow?.sources ?? {};

  // Determine active adapters
  const activeAdapterKeys = enabledSources ?? Object.entries(sourcesConfig)
    .filter(([, enabled]) => enabled === true)
    .map(([k]) => k);

  // Default: run all if nothing configured
  const adapterKeys = activeAdapterKeys.length > 0
    ? activeAdapterKeys.filter(k => k in ALL_ADAPTERS)
    : Object.keys(ALL_ADAPTERS);

  // ── Create run record
  const runRow = row0(await db.execute(sql`
    INSERT INTO opportunity_discovery_runs (org_id, status)
    VALUES (${orgId}, 'running')
    RETURNING id
  `));
  const runId: string = runRow?.id ?? "unknown";

  await db.execute(sql`
    INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
    VALUES (${orgId}, 'Discovery Agent', 'Discovery Agent started.', 'scan')
  `);

  let totalScanned  = 0;
  let totalCreated  = 0;
  let totalRejected = 0;
  let totalDupes    = 0;
  const runNotes: string[] = [];

  try {
    // ── Run each adapter
    for (const key of adapterKeys) {
      const adapter = ALL_ADAPTERS[key]?.();
      if (!adapter) continue;

      let discovered: DiscoveredOpportunity[] = [];
      try {
        discovered = await adapter.discover();
      } catch (e: any) {
        runNotes.push(`${adapter.name}: error — ${e.message}`);
        await db.execute(sql`
          INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
          VALUES (${orgId}, 'Discovery Agent', ${`Discovery Agent: ${adapter.name} failed — ${e.message}`}, 'info')
        `);
        continue;
      }

      totalScanned += discovered.length;

      for (const raw of discovered) {
        // ── Filter
        if (!passesFilter(raw)) {
          totalRejected++;
          continue;
        }

        // ── Fingerprint + dedup check
        const fp = fingerprint(raw.title, raw.company ?? "", raw.location ?? "");

        const existing = row0(await db.execute(sql`
          SELECT id FROM opportunity_acquisition_opportunities
          WHERE org_id = ${orgId} AND fingerprint = ${fp}
          LIMIT 1
        `));

        if (existing) {
          totalDupes++;
          continue;
        }

        // ── Determine location type
        const locLower = (raw.location ?? "").toLowerCase();
        const locType  =
          raw.remoteType === "remote" || locLower.includes("remote") ? "Remote" :
          raw.remoteType === "hybrid" || locLower.includes("hybrid") ? "Hybrid" : "Local";

        // ── Estimate value if missing
        const estimatedValue = raw.estimatedValue ?? deriveValueFromTitle(raw.title);

        // ── Insert
        await db.execute(sql`
          INSERT INTO opportunity_acquisition_opportunities
            (org_id, title, company, source, location, type, estimated_value,
             status, notes, fingerprint)
          VALUES (
            ${orgId},
            ${raw.title},
            ${raw.company ?? ""},
            ${raw.source},
            ${locType},
            ${"coaching"},
            ${estimatedValue},
            ${"new"},
            ${raw.description ?? ""},
            ${fp}
          )
        `);
        totalCreated++;
      }
    }

    await db.execute(sql`
      INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
      VALUES (${orgId}, 'Discovery Agent',
        ${`Discovery Agent scanned ${totalScanned} opportunities.`},
        'scan')
    `);
    await db.execute(sql`
      INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
      VALUES (${orgId}, 'Discovery Agent',
        ${`Discovery Agent created ${totalCreated} new opportunities, skipped ${totalDupes} duplicates, rejected ${totalRejected}.`},
        'scan')
    `);

    // ── Mark run complete
    await db.execute(sql`
      UPDATE opportunity_discovery_runs SET
        completed_at          = NOW(),
        status                = 'completed',
        opportunities_scanned = ${totalScanned},
        opportunities_created = ${totalCreated},
        opportunities_rejected = ${totalRejected},
        duplicates_skipped    = ${totalDupes},
        notes                 = ${runNotes.join("; ") || null}
      WHERE id = ${runId}
    `);

    await db.execute(sql`
      INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
      VALUES (${orgId}, 'Discovery Agent', 'Discovery Agent completed.', 'scan')
    `);

  } catch (e: any) {
    await db.execute(sql`
      UPDATE opportunity_discovery_runs SET
        completed_at = NOW(), status = 'failed', notes = ${e.message}
      WHERE id = ${runId}
    `);
    await db.execute(sql`
      INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
      VALUES (${orgId}, 'Discovery Agent', ${`Discovery Agent failed: ${e.message}`}, 'info')
    `);
    throw e;
  }

  return { runId, scanned: totalScanned, created: totalCreated, rejected: totalRejected, duplicates: totalDupes };
}

// ─── Value estimation from title ──────────────────────────────────────────────

function deriveValueFromTitle(title: string): number {
  const t = title.toLowerCase();
  if (t.includes("director") || t.includes("head"))     return 85000;
  if (t.includes("lead") || t.includes("senior"))       return 70000;
  if (t.includes("consultant") || t.includes("specialist")) return 65000;
  if (t.includes("coordinator") || t.includes("analyst")) return 57000;
  if (t.includes("assistant"))                           return 48000;
  return 60000;
}
