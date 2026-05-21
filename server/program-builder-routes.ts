import type { Express } from "express";
import { db } from "./db";
import crypto from "crypto";
import {
  exerciseLibrary, programTemplates, programBlocks, programSessionGroups,
  workoutPrograms, workoutSessions, orgSessions, orgMemberships, orgUsers,
  coachProfiles, userProfiles, workoutSetLogs, athleteStreaks,
} from "@shared/schema";
import { eq, and, desc, asc, or, sql as drizzleSql, gt } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Auth (3-path: OIDC, Bearer, x-org-auth-token) ───────────────────────────
async function resolveAuth(req: any, res: any, next: any) {
  try {
    // Path 1: Replit OIDC cookie
    if (req.user) {
      const uid: string = req.user?.claims?.sub ?? req.user?.id;
      const [coach] = await db.select().from(coachProfiles).where(eq(coachProfiles.userId, uid)).limit(1);
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, uid)).limit(1);
      const orgId = coach?.organizationId ?? profile?.organizationId ?? null;
      if (!orgId) return res.status(403).json({ message: "No organization" });
      req._pbAuth = { userId: uid, orgId, role: "ADMIN" };
      return next();
    }

    // Path 1b: Bearer token
    const authHeader = req.headers.authorization as string | undefined;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const result = await db.execute(drizzleSql`SELECT user_id FROM auth_tokens WHERE token = ${authHeader.slice(7)} AND expires_at > NOW() LIMIT 1`);
        if (result.rows.length > 0) {
          const uid = (result.rows[0] as any).user_id as string;
          const [coach] = await db.select().from(coachProfiles).where(eq(coachProfiles.userId, uid)).limit(1);
          const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, uid)).limit(1);
          const orgId = coach?.organizationId ?? profile?.organizationId ?? null;
          if (orgId) { req._pbAuth = { userId: uid, orgId, role: "ADMIN" }; return next(); }
        }
      } catch {}
    }

    // Path 2: x-org-auth-token
    const token = req.headers["x-org-auth-token"] as string | undefined;
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const [session] = await db.select().from(orgSessions)
        .where(and(eq(orgSessions.tokenHash, tokenHash), gt(orgSessions.expiresAt, new Date()))).limit(1);
      if (session) {
        const [membership] = await db.select().from(orgMemberships)
          .where(and(eq(orgMemberships.userId, session.userId), eq(orgMemberships.orgId, session.orgId))).limit(1);
        req._pbAuth = { userId: session.userId, orgId: session.orgId, role: membership?.role ?? "athlete" };
        return next();
      }
    }

    res.status(401).json({ message: "Not authenticated" });
  } catch {
    res.status(500).json({ message: "Auth error" });
  }
}

function requireCoach(req: any, res: any, next: any) {
  resolveAuth(req, res, () => {
    const role = req._pbAuth?.role ?? "";
    if (!["ADMIN", "admin", "coach", "COACH", "staff", "owner"].includes(role))
      return res.status(403).json({ message: "Coach access required" });
    next();
  });
}

// ─── Global exercise seed data ────────────────────────────────────────────────
const GLOBAL_EXERCISES = [
  { name: "Back Squat", slug: "back-squat", category: "strength", movementPattern: "squat", primaryMuscles: ["quads", "glutes"], secondaryMuscles: ["hamstrings", "core"], equipment: ["barbell", "rack"], difficulty: "intermediate", description: "Compound lower body movement.", coachingCues: ["Chest up", "Knees tracking toes", "Full depth"], commonMistakes: ["Caving knees", "Forward lean"], progressions: ["Pause Squat", "Front Squat"], regressions: ["Goblet Squat", "Box Squat"], tags: ["lower body", "compound"] },
  { name: "Front Squat", slug: "front-squat", category: "strength", movementPattern: "squat", primaryMuscles: ["quads", "core"], secondaryMuscles: ["glutes", "upper back"], equipment: ["barbell", "rack"], difficulty: "advanced", description: "Upright squat with bar in front rack.", coachingCues: ["Elbows high", "Upright torso", "Bar on shoulders"], commonMistakes: ["Dropping elbows", "Forward lean"], progressions: ["Overhead Squat"], regressions: ["Goblet Squat"], tags: ["lower body", "compound"] },
  { name: "Romanian Deadlift", slug: "romanian-deadlift", category: "strength", movementPattern: "hinge", primaryMuscles: ["hamstrings", "glutes"], secondaryMuscles: ["lower back", "core"], equipment: ["barbell"], difficulty: "intermediate", description: "Hip hinge targeting posterior chain.", coachingCues: ["Push hips back", "Maintain neutral spine", "Soft knee"], commonMistakes: ["Rounding back", "Bending knees too much"], progressions: ["Deficit RDL", "Single Leg RDL"], regressions: ["Good Morning", "Hip Hinge"], tags: ["posterior chain", "hinge"] },
  { name: "Conventional Deadlift", slug: "conventional-deadlift", category: "strength", movementPattern: "hinge", primaryMuscles: ["posterior chain"], secondaryMuscles: ["core", "lats"], equipment: ["barbell"], difficulty: "intermediate", description: "Full hip hinge pulling from floor.", coachingCues: ["Lat engagement", "Drive floor away", "Lockout at top"], commonMistakes: ["Jerking off floor", "Rounding"], progressions: ["Deficit Deadlift", "Rack Pull"], regressions: ["Trap Bar Deadlift", "KB Deadlift"], tags: ["full body", "hinge"] },
  { name: "Bench Press", slug: "bench-press", category: "strength", movementPattern: "horizontal push", primaryMuscles: ["chest", "triceps"], secondaryMuscles: ["front deltoid"], equipment: ["barbell", "bench"], difficulty: "intermediate", description: "Horizontal upper body pressing.", coachingCues: ["Retract scapula", "Feet on floor", "Bar path slightly diagonal"], commonMistakes: ["Flared elbows", "Bouncing bar"], progressions: ["Close Grip Bench", "Paused Bench"], regressions: ["DB Bench", "Floor Press"], tags: ["upper body", "push"] },
  { name: "Overhead Press", slug: "overhead-press", category: "strength", movementPattern: "vertical push", primaryMuscles: ["deltoids", "triceps"], secondaryMuscles: ["core", "upper chest"], equipment: ["barbell"], difficulty: "intermediate", description: "Vertical pressing from shoulder to overhead.", coachingCues: ["Squeeze glutes", "Ribs down", "Bar over mid foot"], commonMistakes: ["Leaning back", "Flared ribs"], progressions: ["Push Press", "Jerk"], regressions: ["DB Press", "Landmine Press"], tags: ["upper body", "push"] },
  { name: "Barbell Row", slug: "barbell-row", category: "strength", movementPattern: "horizontal pull", primaryMuscles: ["lats", "rhomboids"], secondaryMuscles: ["biceps", "rear deltoid"], equipment: ["barbell"], difficulty: "intermediate", description: "Bent-over horizontal pulling.", coachingCues: ["Flat back", "Pull to hip", "Lead with elbows"], commonMistakes: ["Jerking body", "Rounding back"], progressions: ["Pendlay Row", "Single Arm Row"], regressions: ["Seated Row", "DB Row"], tags: ["upper body", "pull"] },
  { name: "Pull Up", slug: "pull-up", category: "strength", movementPattern: "vertical pull", primaryMuscles: ["lats", "biceps"], secondaryMuscles: ["rear deltoid", "core"], equipment: ["pullup bar"], difficulty: "intermediate", description: "Bodyweight vertical pulling.", coachingCues: ["Depress scapula", "Pull elbows down", "Full ROM"], commonMistakes: ["Kipping", "Partial ROM"], progressions: ["Weighted Pull Up", "L-sit Pull Up"], regressions: ["Assisted Pull Up", "Lat Pulldown"], tags: ["upper body", "pull", "bodyweight"] },
  { name: "Power Clean", slug: "power-clean", category: "power", movementPattern: "full body", primaryMuscles: ["posterior chain", "traps"], secondaryMuscles: ["core", "quads"], equipment: ["barbell"], difficulty: "advanced", description: "Olympic lift from floor to front rack.", coachingCues: ["Maintain position off floor", "Violent hip extension", "Fast elbows"], commonMistakes: ["Early arm pull", "Poor catch position"], progressions: ["Hang Squat Clean", "Full Clean"], regressions: ["Hang Power Clean", "High Pull"], tags: ["olympic lift", "power"] },
  { name: "Hang Power Clean", slug: "hang-power-clean", category: "power", movementPattern: "full body", primaryMuscles: ["posterior chain", "traps"], secondaryMuscles: ["core"], equipment: ["barbell"], difficulty: "intermediate", description: "Power clean from hang position.", coachingCues: ["Push hips back first", "Shrug and pull", "Rack with high elbows"], commonMistakes: ["Arm pull", "Soft catch"], progressions: ["Power Clean", "Squat Clean"], regressions: ["High Pull", "Dumbbell Clean"], tags: ["power", "olympic lift"] },
  { name: "Box Jump", slug: "box-jump", category: "plyometric", movementPattern: "jump", primaryMuscles: ["quads", "glutes"], secondaryMuscles: ["calves", "core"], equipment: ["plyometric box"], difficulty: "intermediate", description: "Explosive jump onto elevated surface.", coachingCues: ["Full arm swing", "Land softly", "Step down"], commonMistakes: ["Landing hard", "Rushing reset"], progressions: ["Depth Jump", "Single Leg Box Jump"], regressions: ["Broad Jump", "Step Up"], tags: ["plyometric", "explosive"] },
  { name: "Sprint 10m", slug: "sprint-10m", category: "speed", movementPattern: "sprint", primaryMuscles: ["quads", "hamstrings", "glutes"], secondaryMuscles: ["calves", "core"], equipment: [], difficulty: "intermediate", description: "10 meter acceleration sprint.", coachingCues: ["Forward lean at start", "Drive arms", "High knee lift"], commonMistakes: ["Upright too early", "Over striding"], progressions: ["Sprint 20m", "Resisted Sprint"], regressions: ["Falling Start", "A-skip"], tags: ["speed", "acceleration"] },
  { name: "Nordic Hamstring Curl", slug: "nordic-hamstring-curl", category: "strength", movementPattern: "knee flexion", primaryMuscles: ["hamstrings"], secondaryMuscles: ["glutes", "calves"], equipment: ["partner", "glute-ham device"], difficulty: "advanced", description: "Eccentric hamstring strengthening.", coachingCues: ["Control descent", "Straight body line", "Brace core"], commonMistakes: ["Breaking at hips", "Too fast"], progressions: ["Loaded Nordic", "Single Leg"], regressions: ["Leg Curl", "Glute Bridge"], tags: ["injury prevention", "eccentric", "hamstrings"] },
  { name: "Hip Thrust", slug: "hip-thrust", category: "strength", movementPattern: "hip extension", primaryMuscles: ["glutes"], secondaryMuscles: ["hamstrings", "core"], equipment: ["barbell", "bench"], difficulty: "beginner", description: "Loaded hip extension for glute development.", coachingCues: ["Drive through heels", "Squeeze at top", "Chin tuck"], commonMistakes: ["Hyperextending back", "Feet too close"], progressions: ["Single Leg Hip Thrust", "Banded Hip Thrust"], regressions: ["Glute Bridge", "Bodyweight Hip Thrust"], tags: ["glutes", "hip extension"] },
  { name: "Plank", slug: "plank", category: "core", movementPattern: "isometric", primaryMuscles: ["core", "transverse abdominis"], secondaryMuscles: ["shoulders", "glutes"], equipment: [], difficulty: "beginner", description: "Isometric core stability hold.", coachingCues: ["Squeeze everything", "Neutral spine", "Don't hold breath"], commonMistakes: ["Hips too high", "Sagging hips"], progressions: ["Weighted Plank", "Plank Shoulder Tap"], regressions: ["Knee Plank"], tags: ["core", "stability", "bodyweight"] },
  { name: "Farmers Carry", slug: "farmers-carry", category: "conditioning", movementPattern: "loaded carry", primaryMuscles: ["core", "grip", "traps"], secondaryMuscles: ["quads", "glutes"], equipment: ["kettlebell", "dumbbell", "trap bar"], difficulty: "beginner", description: "Loaded walking for full-body conditioning.", coachingCues: ["Tall spine", "Short steps", "Shoulder packed"], commonMistakes: ["Leaning to one side", "Loose grip"], progressions: ["Overhead Carry", "Zercher Carry"], regressions: ["Shorter distance", "Lighter load"], tags: ["carries", "full body", "conditioning"] },
  { name: "Medicine Ball Slam", slug: "medicine-ball-slam", category: "power", movementPattern: "throw", primaryMuscles: ["core", "lats", "shoulders"], secondaryMuscles: ["quads", "glutes"], equipment: ["medicine ball"], difficulty: "beginner", description: "Explosive overhead slam for power development.", coachingCues: ["Full overhead reach", "Slam through ball", "Follow through"], commonMistakes: ["Not reaching fully overhead", "Arms only"], progressions: ["Rotational Slam", "Single Leg"], regressions: ["Wall Ball"], tags: ["power", "explosive", "core"] },
  { name: "Split Squat", slug: "split-squat", category: "strength", movementPattern: "lunge", primaryMuscles: ["quads", "glutes"], secondaryMuscles: ["hamstrings", "core"], equipment: ["bodyweight", "dumbbell", "barbell"], difficulty: "beginner", description: "Unilateral lower body strength.", coachingCues: ["Vertical shin on front leg", "Hip down not forward", "Tall torso"], commonMistakes: ["Knee caving", "Leaning forward"], progressions: ["Bulgarian Split Squat", "Rear Foot Elevated"], regressions: ["Static Lunge", "Step Up"], tags: ["lower body", "unilateral"] },
  { name: "Glute Bridge", slug: "glute-bridge", category: "strength", movementPattern: "hip extension", primaryMuscles: ["glutes"], secondaryMuscles: ["hamstrings"], equipment: [], difficulty: "beginner", description: "Supine hip extension.", coachingCues: ["Posterior pelvic tilt", "Squeeze at top", "Drive through heels"], commonMistakes: ["Overextending"], progressions: ["Hip Thrust", "Single Leg Bridge"], regressions: [], tags: ["glutes", "beginner", "bodyweight"] },
  { name: "Battle Ropes", slug: "battle-ropes", category: "conditioning", movementPattern: "wave", primaryMuscles: ["shoulders", "core"], secondaryMuscles: ["arms", "legs"], equipment: ["battle ropes"], difficulty: "beginner", description: "High intensity conditioning with ropes.", coachingCues: ["Stable base", "Drive from hips", "Full arm motion"], commonMistakes: ["Arms only", "Not breathing"], progressions: ["Alternating waves", "Power slams"], regressions: ["Reduced duration"], tags: ["conditioning", "hiit"] },
];

async function seedGlobalExercises() {
  const existing = await db.select({ count: drizzleSql<number>`count(*)` })
    .from(exerciseLibrary).where(eq(exerciseLibrary.isGlobal, true));
  if (Number(existing[0]?.count ?? 0) > 0) return;

  await db.insert(exerciseLibrary).values(
    GLOBAL_EXERCISES.map((ex) => ({ ...ex, isGlobal: true }))
  );
}

// ─── Register Routes ──────────────────────────────────────────────────────────
export function registerProgramBuilderRoutes(app: Express) {

  // ── Exercise Library ────────────────────────────────────────────────────────

  // GET /api/org/exercises
  app.get("/api/org/exercises", resolveAuth, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    await seedGlobalExercises();

    const { q, category, equipment, difficulty, movementPattern } = req.query as Record<string, string>;

    let exercises = await db.select().from(exerciseLibrary)
      .where(or(eq(exerciseLibrary.isGlobal, true), eq(exerciseLibrary.orgId, orgId)))
      .orderBy(asc(exerciseLibrary.name));

    if (q) {
      const lower = q.toLowerCase();
      exercises = exercises.filter((e) =>
        e.name.toLowerCase().includes(lower) ||
        (e.category ?? "").toLowerCase().includes(lower) ||
        (e.movementPattern ?? "").toLowerCase().includes(lower) ||
        JSON.stringify(e.tags ?? []).toLowerCase().includes(lower)
      );
    }
    if (category) exercises = exercises.filter((e) => e.category === category);
    if (difficulty) exercises = exercises.filter((e) => e.difficulty === difficulty);
    if (movementPattern) exercises = exercises.filter((e) => e.movementPattern === movementPattern);
    if (equipment) exercises = exercises.filter((e) => JSON.stringify(e.equipment ?? []).toLowerCase().includes(equipment.toLowerCase()));

    res.json({ exercises });
  });

  // POST /api/org/exercises
  app.post("/api/org/exercises", requireCoach, async (req: any, res) => {
    const { orgId, userId } = req._pbAuth;
    const { name, category = "strength", movementPattern, primaryMuscles = [], secondaryMuscles = [], equipment = [], difficulty = "intermediate", description, coachingCues = [], commonMistakes = [], progressions = [], regressions = [], youtubeUrl, tags = [] } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const [ex] = await db.insert(exerciseLibrary).values({
      orgId, name, slug, category, movementPattern, primaryMuscles, secondaryMuscles,
      equipment, difficulty, description, coachingCues, commonMistakes, progressions,
      regressions, youtubeUrl, tags, isGlobal: false, createdByUserId: userId,
    }).returning();

    res.json({ exercise: ex });
  });

  // PATCH /api/org/exercises/:id
  app.patch("/api/org/exercises/:id", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { id } = req.params;
    const updates: any = {};
    ["name", "category", "movementPattern", "primaryMuscles", "secondaryMuscles", "equipment", "difficulty", "description", "coachingCues", "commonMistakes", "progressions", "regressions", "youtubeUrl", "videoUrl", "thumbnailUrl", "tags"].forEach((k) => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    const [updated] = await db.update(exerciseLibrary).set(updates)
      .where(and(eq(exerciseLibrary.id, id), eq(exerciseLibrary.orgId, orgId)))
      .returning();
    res.json({ exercise: updated });
  });

  // ── Program Builder ─────────────────────────────────────────────────────────

  // GET /api/org/workout-builder/programs/:id/sessions — all sessions for a program
  app.get("/api/org/workout-builder/programs/:id/sessions", resolveAuth, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { id } = req.params;

    const [program] = await db.select().from(workoutPrograms)
      .where(and(eq(workoutPrograms.id, id), eq(workoutPrograms.orgId, orgId))).limit(1);
    if (!program) return res.status(404).json({ message: "Program not found" });

    const [sessions, blocks, groups] = await Promise.all([
      db.select().from(workoutSessions)
        .where(and(eq(workoutSessions.workoutProgramId, id), eq(workoutSessions.orgId, orgId)))
        .orderBy(asc(workoutSessions.weekNumber), asc(workoutSessions.dayNumber)),
      db.select().from(programBlocks).where(eq(programBlocks.workoutProgramId, id)).orderBy(asc(programBlocks.weekNumber)),
      db.select().from(programSessionGroups)
        .where(drizzleSql`${programSessionGroups.workoutSessionId} IN (
          SELECT id FROM workout_sessions WHERE workout_program_id = ${id} AND org_id = ${orgId}
        )`),
    ]);

    // Group sessions by week
    const weeks: Record<number, any> = {};
    for (const s of sessions) {
      if (!weeks[s.weekNumber]) {
        const block = blocks.find((b) => b.weekNumber === s.weekNumber);
        weeks[s.weekNumber] = {
          weekNumber: s.weekNumber,
          title: block?.title ?? `Week ${s.weekNumber}`,
          description: block?.description ?? null,
          blockType: block?.blockType ?? "standard",
          sessions: [],
        };
      }
      const sessionGroups = groups.filter((g) => g.workoutSessionId === s.id);
      weeks[s.weekNumber].sessions.push({ ...s, groups: sessionGroups });
    }

    res.json({ program, weeks: Object.values(weeks).sort((a, b) => a.weekNumber - b.weekNumber) });
  });

  // PATCH /api/org/workout-builder/sessions/:id — update session data (exercises, title, focus)
  app.patch("/api/org/workout-builder/sessions/:id", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { id } = req.params;
    const { sessionData, title, focus } = req.body;

    const updates: any = {};
    if (sessionData !== undefined) updates.sessionData = sessionData;
    if (title !== undefined) updates.title = title;
    if (focus !== undefined) updates.focus = focus;

    const [updated] = await db.update(workoutSessions).set(updates)
      .where(and(eq(workoutSessions.id, id), eq(workoutSessions.orgId, orgId)))
      .returning();
    res.json({ session: updated });
  });

  // PATCH /api/org/workout-builder/sessions/:id/reorder — reorder exercises within session
  app.patch("/api/org/workout-builder/sessions/:id/reorder", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { id } = req.params;
    const { exercises } = req.body; // Full reordered exercises array

    const [session] = await db.select().from(workoutSessions)
      .where(and(eq(workoutSessions.id, id), eq(workoutSessions.orgId, orgId))).limit(1);
    if (!session) return res.status(404).json({ message: "Session not found" });

    const currentData = (session.sessionData as any) ?? {};
    const [updated] = await db.update(workoutSessions)
      .set({ sessionData: { ...currentData, exercises } })
      .where(eq(workoutSessions.id, id))
      .returning();

    res.json({ session: updated });
  });

  // POST /api/org/workout-builder/sessions/:id/exercises — add exercise to session
  app.post("/api/org/workout-builder/sessions/:id/exercises", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { id } = req.params;
    const exercise = req.body;

    const [session] = await db.select().from(workoutSessions)
      .where(and(eq(workoutSessions.id, id), eq(workoutSessions.orgId, orgId))).limit(1);
    if (!session) return res.status(404).json({ message: "Session not found" });

    const currentData = (session.sessionData as any) ?? {};
    const existing: any[] = currentData.exercises ?? [];
    const newExercise = {
      name: exercise.name,
      sets: exercise.sets ?? "3",
      reps: exercise.reps ?? "8",
      load: exercise.load ?? "",
      rpe: exercise.rpe ?? "",
      rest: exercise.rest ?? "90s",
      notes: exercise.notes ?? "",
      category: exercise.category,
      movementPattern: exercise.movementPattern,
      coachingCues: exercise.coachingCues ?? [],
      youtubeUrl: exercise.youtubeUrl ?? null,
      _exId: exercise.id ?? null,
    };

    const [updated] = await db.update(workoutSessions)
      .set({ sessionData: { ...currentData, exercises: [...existing, newExercise] } })
      .where(eq(workoutSessions.id, id))
      .returning();

    res.json({ session: updated });
  });

  // DELETE /api/org/workout-builder/sessions/:id/exercises/:index
  app.delete("/api/org/workout-builder/sessions/:id/exercises/:index", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { id, index } = req.params;
    const idx = parseInt(index, 10);

    const [session] = await db.select().from(workoutSessions)
      .where(and(eq(workoutSessions.id, id), eq(workoutSessions.orgId, orgId))).limit(1);
    if (!session) return res.status(404).json({ message: "Not found" });

    const currentData = (session.sessionData as any) ?? {};
    const exercises: any[] = currentData.exercises ?? [];
    const newExercises = exercises.filter((_, i) => i !== idx);

    const [updated] = await db.update(workoutSessions)
      .set({ sessionData: { ...currentData, exercises: newExercises } })
      .where(eq(workoutSessions.id, id))
      .returning();

    res.json({ session: updated });
  });

  // PATCH /api/org/workout-builder/sessions/:id/exercises/:index — update single exercise
  app.patch("/api/org/workout-builder/sessions/:id/exercises/:index", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { id, index } = req.params;
    const idx = parseInt(index, 10);
    const updates = req.body;

    const [session] = await db.select().from(workoutSessions)
      .where(and(eq(workoutSessions.id, id), eq(workoutSessions.orgId, orgId))).limit(1);
    if (!session) return res.status(404).json({ message: "Not found" });

    const currentData = (session.sessionData as any) ?? {};
    const exercises: any[] = [...(currentData.exercises ?? [])];
    if (idx < 0 || idx >= exercises.length) return res.status(400).json({ error: "Invalid index" });

    exercises[idx] = { ...exercises[idx], ...updates };
    const [updated] = await db.update(workoutSessions)
      .set({ sessionData: { ...currentData, exercises } })
      .where(eq(workoutSessions.id, id))
      .returning();

    res.json({ session: updated });
  });

  // POST /api/org/workout-builder/sessions — create new session
  app.post("/api/org/workout-builder/sessions", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { workoutProgramId, weekNumber, dayNumber, title, focus } = req.body;
    if (!workoutProgramId || !weekNumber || !dayNumber) return res.status(400).json({ error: "workoutProgramId, weekNumber, dayNumber required" });

    const [session] = await db.insert(workoutSessions).values({
      orgId, workoutProgramId, weekNumber, dayNumber,
      title: title ?? `Week ${weekNumber} Day ${dayNumber}`,
      focus: focus ?? null,
      sessionData: { exercises: [], notes: "" },
    }).returning();

    res.json({ session });
  });

  // DELETE /api/org/workout-builder/sessions/:id
  app.delete("/api/org/workout-builder/sessions/:id", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { id } = req.params;
    await db.delete(workoutSessions)
      .where(and(eq(workoutSessions.id, id), eq(workoutSessions.orgId, orgId)));
    res.json({ ok: true });
  });

  // POST /api/org/workout-builder/sessions/:id/duplicate — duplicate session into next day
  app.post("/api/org/workout-builder/sessions/:id/duplicate", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { id } = req.params;
    const { weekNumber, dayNumber } = req.body;

    const [source] = await db.select().from(workoutSessions)
      .where(and(eq(workoutSessions.id, id), eq(workoutSessions.orgId, orgId))).limit(1);
    if (!source) return res.status(404).json({ message: "Not found" });

    const [copy] = await db.insert(workoutSessions).values({
      orgId, workoutProgramId: source.workoutProgramId,
      weekNumber: weekNumber ?? source.weekNumber,
      dayNumber: dayNumber ?? source.dayNumber + 1,
      title: `${source.title} (Copy)`,
      focus: source.focus,
      sessionData: source.sessionData,
    }).returning();

    res.json({ session: copy });
  });

  // PATCH /api/org/workout-builder/programs/:id/reorder — reorder sessions in a week
  app.patch("/api/org/workout-builder/programs/:id/reorder", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { id } = req.params;
    const { weekNumber, sessionOrder }: { weekNumber: number; sessionOrder: Array<{ id: string; dayNumber: number }> } = req.body;

    await Promise.all(sessionOrder.map((s) =>
      db.update(workoutSessions).set({ dayNumber: s.dayNumber })
        .where(and(eq(workoutSessions.id, s.id), eq(workoutSessions.orgId, orgId)))
    ));

    res.json({ ok: true });
  });

  // PATCH /api/org/workout-builder/programs/:id/blocks — upsert week block metadata
  app.patch("/api/org/workout-builder/programs/:id/blocks", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { id } = req.params;
    const { weekNumber, title, description, blockType } = req.body;

    const [existing] = await db.select().from(programBlocks)
      .where(and(eq(programBlocks.workoutProgramId, id), eq(programBlocks.weekNumber, weekNumber))).limit(1);

    if (existing) {
      const [updated] = await db.update(programBlocks)
        .set({ ...(title !== undefined && { title }), ...(description !== undefined && { description }), ...(blockType && { blockType }) })
        .where(eq(programBlocks.id, existing.id)).returning();
      res.json({ block: updated });
    } else {
      const [block] = await db.insert(programBlocks).values({ workoutProgramId: id, weekNumber, title, description, blockType: blockType ?? "standard" }).returning();
      res.json({ block });
    }
  });

  // ── Session Groups (supersets / circuits) ───────────────────────────────────

  // GET /api/org/workout-builder/groups/:sessionId
  app.get("/api/org/workout-builder/groups/:sessionId", resolveAuth, async (req: any, res) => {
    const { sessionId } = req.params;
    const groups = await db.select().from(programSessionGroups)
      .where(eq(programSessionGroups.workoutSessionId, sessionId))
      .orderBy(asc(programSessionGroups.orderIndex));
    res.json({ groups });
  });

  // POST /api/org/workout-builder/groups
  app.post("/api/org/workout-builder/groups", requireCoach, async (req: any, res) => {
    const { workoutSessionId, groupType, title, exerciseIndices, orderIndex } = req.body;
    if (!workoutSessionId || !groupType) return res.status(400).json({ error: "workoutSessionId and groupType required" });

    const [group] = await db.insert(programSessionGroups).values({
      workoutSessionId, groupType, title, exerciseIndices: exerciseIndices ?? [], orderIndex: orderIndex ?? 0,
    }).returning();
    res.json({ group });
  });

  // PATCH /api/org/workout-builder/groups/:id
  app.patch("/api/org/workout-builder/groups/:id", requireCoach, async (req: any, res) => {
    const { id } = req.params;
    const { groupType, title, exerciseIndices, orderIndex } = req.body;
    const updates: any = {};
    if (groupType) updates.groupType = groupType;
    if (title !== undefined) updates.title = title;
    if (exerciseIndices) updates.exerciseIndices = exerciseIndices;
    if (orderIndex !== undefined) updates.orderIndex = orderIndex;

    const [updated] = await db.update(programSessionGroups).set(updates)
      .where(eq(programSessionGroups.id, id)).returning();
    res.json({ group: updated });
  });

  // DELETE /api/org/workout-builder/groups/:id
  app.delete("/api/org/workout-builder/groups/:id", requireCoach, async (req: any, res) => {
    await db.delete(programSessionGroups).where(eq(programSessionGroups.id, req.params.id));
    res.json({ ok: true });
  });

  // ── Templates ───────────────────────────────────────────────────────────────

  // GET /api/org/program-templates
  app.get("/api/org/program-templates", resolveAuth, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const templates = await db.select().from(programTemplates)
      .where(or(eq(programTemplates.orgId, orgId), eq(programTemplates.visibility, "public")))
      .orderBy(desc(programTemplates.createdAt));
    res.json({ templates });
  });

  // POST /api/org/program-templates — save current program as template
  app.post("/api/org/program-templates", requireCoach, async (req: any, res) => {
    const { orgId, userId } = req._pbAuth;
    const { title, description, sport, category, visibility = "private", programId } = req.body;
    if (!title) return res.status(400).json({ error: "title required" });

    let templateData: any = {};
    if (programId) {
      const [program] = await db.select().from(workoutPrograms)
        .where(and(eq(workoutPrograms.id, programId), eq(workoutPrograms.orgId, orgId))).limit(1);
      if (program) {
        const sessions = await db.select().from(workoutSessions)
          .where(and(eq(workoutSessions.workoutProgramId, programId), eq(workoutSessions.orgId, orgId)))
          .orderBy(asc(workoutSessions.weekNumber), asc(workoutSessions.dayNumber));
        templateData = { program: { title: program.title, goal: program.goal, sport: program.sport, durationWeeks: program.durationWeeks, daysPerWeek: program.daysPerWeek }, sessions: sessions.map((s) => ({ weekNumber: s.weekNumber, dayNumber: s.dayNumber, title: s.title, focus: s.focus, sessionData: s.sessionData })) };
      }
    }

    const [template] = await db.insert(programTemplates).values({
      orgId, createdByUserId: userId, title, description, sport, category, visibility, templateData,
    }).returning();
    res.json({ template });
  });

  // DELETE /api/org/program-templates/:id
  app.delete("/api/org/program-templates/:id", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    await db.delete(programTemplates)
      .where(and(eq(programTemplates.id, req.params.id), eq(programTemplates.orgId, orgId)));
    res.json({ ok: true });
  });

  // ── Refine with TrainChat (AI) ──────────────────────────────────────────────
  app.post("/api/org/workout-builder/refine-with-trainchat", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { programId, sessionId, instruction, currentExercises } = req.body;
    if (!instruction) return res.status(400).json({ error: "instruction required" });

    const context = currentExercises ? JSON.stringify(currentExercises, null, 2) : "No exercises provided";

    const prompt = `You are an expert strength and conditioning coach AI. A coach wants to refine a workout session.

CURRENT EXERCISES:
${context}

COACH INSTRUCTION:
"${instruction}"

RULES:
- Keep sport science principles
- Maintain logical exercise order (activation → compound → accessory)
- Preserve sets/reps/load format: use strings like "3", "8", "75kg" or "BW"
- Return ONLY the modified exercises array, not a full program
- Respect the existing structure, only apply the specific change requested

Return JSON: { "exercises": [{ "name": "...", "sets": "3", "reps": "8", "load": "70kg", "rpe": "7", "rest": "90s", "notes": "..." }], "summary": "Brief summary of changes made" }`;

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 1200,
      });
      const result = JSON.parse(completion.choices[0].message.content ?? "{}");
      res.json({ exercises: result.exercises ?? [], summary: result.summary ?? "Changes applied." });
    } catch {
      res.status(500).json({ error: "AI refinement failed" });
    }
  });

  // ── POST /api/org/workout-execution/session/:id/finish ────────────────────────
  app.post("/api/org/workout-execution/session/:id/finish", resolveAuth, async (req: any, res) => {
    const { id } = req.params;
    const { orgId, userId } = req._pbAuth;

    // Verify session belongs to org
    const [session] = await db.select().from(workoutSessions)
      .where(and(eq(workoutSessions.id, id), eq(workoutSessions.orgId, orgId))).limit(1);
    if (!session) return res.status(404).json({ message: "Session not found" });

    const { readinessData, exerciseLogs, completionNotes, completionRating } = req.body ?? {};

    // Persist set logs
    if (Array.isArray(exerciseLogs)) {
      for (let ei = 0; ei < exerciseLogs.length; ei++) {
        const exLog = exerciseLogs[ei];
        const setLogs: any[] = exLog.setLogs ?? exLog.completedData ? [exLog.completedData] : [];
        for (let si = 0; si < setLogs.length; si++) {
          const s = setLogs[si];
          if (!s) continue;
          await db.insert(workoutSetLogs).values({
            orgId, workoutSessionId: id, athleteUserId: userId,
            exerciseIndex: ei, exerciseName: exLog.exerciseName ?? `Exercise ${ei + 1}`,
            setNumber: si + 1,
            actualReps: s.actualReps ?? s.reps ?? null,
            actualLoad: s.actualLoad ?? s.load ?? null,
            rpe: s.rpe ?? null,
            completed: s.completed ?? true,
            notes: exLog.notes ?? null,
          }).catch(() => {});
        }
      }
    }

    // Update streak
    const streak = await updateAthleteStreak(orgId, userId);

    res.json({ success: true, streak });
  });

  // ── GET single session (for athlete execution) ──────────────────────────────
  app.get("/api/org/workout-builder/session/:id", resolveAuth, async (req: any, res) => {
    const { id } = req.params;
    const { orgId } = req._pbAuth;

    const [session] = await db.select().from(workoutSessions)
      .where(and(eq(workoutSessions.id, id), eq(workoutSessions.orgId, orgId))).limit(1);
    if (!session) return res.status(404).json({ message: "Session not found" });

    const groups = await db.select().from(programSessionGroups)
      .where(eq(programSessionGroups.workoutSessionId, id))
      .orderBy(asc(programSessionGroups.orderIndex));

    res.json({ session, groups });
  });

  // ── POST /api/org/exercises/:id/media — attach media to exercise ────────────
  app.post("/api/org/exercises/:id/media", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { id } = req.params;
    const { youtubeUrl, embeddedVideoUrl, videoUrl, gifUrl, thumbnailUrl, coachVoiceoverUrl, demoType } = req.body;

    const updates: any = {};
    if (youtubeUrl !== undefined) updates.youtubeUrl = youtubeUrl;
    if (embeddedVideoUrl !== undefined) updates.embeddedVideoUrl = embeddedVideoUrl;
    if (videoUrl !== undefined) updates.videoUrl = videoUrl;
    if (gifUrl !== undefined) updates.gifUrl = gifUrl;
    if (thumbnailUrl !== undefined) updates.thumbnailUrl = thumbnailUrl;
    if (coachVoiceoverUrl !== undefined) updates.coachVoiceoverUrl = coachVoiceoverUrl;
    if (demoType !== undefined) updates.demoType = demoType;

    // Allow updating global exercises too (coaches can add media to global library)
    const [updated] = await db.update(exerciseLibrary).set(updates)
      .where(or(
        and(eq(exerciseLibrary.id, id), eq(exerciseLibrary.orgId, orgId)),
        eq(exerciseLibrary.id, id),
      )).returning();

    res.json({ exercise: updated });
  });

  // ── POST /api/org/exercises/:id/ask-trainchat ────────────────────────────────
  app.post("/api/org/exercises/:id/ask-trainchat", resolveAuth, async (req: any, res) => {
    const { id } = req.params;
    const { question, exerciseName } = req.body;
    if (!question) return res.status(400).json({ error: "question required" });

    // Get exercise context from DB if available
    const [ex] = await db.select().from(exerciseLibrary).where(eq(exerciseLibrary.id, id)).limit(1);
    const context = ex ? JSON.stringify({
      name: ex.name,
      category: ex.category,
      movementPattern: ex.movementPattern,
      primaryMuscles: ex.primaryMuscles,
      coachingCues: ex.coachingCues,
      commonMistakes: ex.commonMistakes,
      description: ex.description,
    }) : `Exercise: ${exerciseName ?? "Unknown"}`;

    const systemPrompt = `You are an expert strength and conditioning coach. Answer athlete questions about exercises clearly and concisely. Be encouraging and practical. Keep answers to 2-4 sentences.`;
    const userPrompt = `Exercise context: ${context}\n\nAthlete question: "${question}"`;

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 300,
      });
      res.json({ answer: completion.choices[0].message.content ?? "No answer available." });
    } catch {
      res.status(500).json({ error: "AI unavailable" });
    }
  });

  // ── PATCH /api/org/workout-execution/set-log — log individual set ─────────────
  app.patch("/api/org/workout-execution/set-log", resolveAuth, async (req: any, res) => {
    const { orgId, userId } = req._pbAuth;
    const { workoutSessionId, exerciseIndex, exerciseName, setNumber, actualReps, actualLoad, rpe, completed, notes } = req.body;
    if (!workoutSessionId || !exerciseName) return res.status(400).json({ error: "workoutSessionId and exerciseName required" });

    const [log] = await db.insert(workoutSetLogs).values({
      orgId, workoutSessionId, athleteUserId: userId,
      exerciseIndex: exerciseIndex ?? 0, exerciseName,
      setNumber: setNumber ?? 1, actualReps, actualLoad,
      rpe: rpe ?? null, completed: completed ?? false, notes,
    }).returning();

    res.json({ log });
  });

  // ── GET /api/org/workout-execution/streak — get athlete streak ────────────────
  app.get("/api/org/workout-execution/streak", resolveAuth, async (req: any, res) => {
    const { orgId, userId } = req._pbAuth;
    const [streak] = await db.select().from(athleteStreaks)
      .where(and(eq(athleteStreaks.orgId, orgId), eq(athleteStreaks.athleteUserId, userId))).limit(1);
    res.json({ streak: streak ?? { currentStreak: 0, longestStreak: 0, totalSessionsCompleted: 0 } });
  });

  // ── GET /api/org/exercises/media-coverage ──────────────────────────────────────
  app.get("/api/org/exercises/media-coverage", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { search, category, hasVideo, hasNoCues } = req.query;

    // Fetch all exercises visible to this org (global + org-specific)
    const exercises = await db.select().from(exerciseLibrary)
      .where(or(eq(exerciseLibrary.isGlobal, true), eq(exerciseLibrary.orgId, orgId)))
      .orderBy(asc(exerciseLibrary.name));

    function scoreExercise(ex: any) {
      let score = 0;
      const maxScore = 5;
      if (ex.youtubeUrl || ex.videoUrl || ex.gifUrl) score++;
      if ((ex.coachingCues as any[])?.length > 0) score++;
      if ((ex.progressions as any[])?.length > 0) score++;
      if ((ex.regressions as any[])?.length > 0) score++;
      if ((ex.commonMistakes as any[])?.length > 0) score++;
      return { score, pct: Math.round((score / maxScore) * 100) };
    }

    let enriched = exercises.map((ex) => {
      const { score, pct } = scoreExercise(ex);
      return {
        ...ex,
        mediaCoverageScore: pct,
        hasVideo: !!(ex.youtubeUrl || ex.videoUrl || ex.gifUrl),
        hasCues: (ex.coachingCues as any[])?.length > 0,
        hasProgressions: (ex.progressions as any[])?.length > 0,
        hasRegressions: (ex.regressions as any[])?.length > 0,
        hasMistakes: (ex.commonMistakes as any[])?.length > 0,
      };
    });

    // Apply filters
    if (search) enriched = enriched.filter((e) => e.name.toLowerCase().includes((search as string).toLowerCase()));
    if (category && category !== "all") enriched = enriched.filter((e) => e.category === category);
    if (hasVideo === "false") enriched = enriched.filter((e) => !e.hasVideo);
    if (hasNoCues === "true") enriched = enriched.filter((e) => !e.hasCues);

    const total = enriched.length;
    const fullyEnriched = enriched.filter((e) => e.mediaCoverageScore === 100).length;
    const missingVideo = enriched.filter((e) => !e.hasVideo).length;
    const missingCues = enriched.filter((e) => !e.hasCues).length;
    const missingProgressions = enriched.filter((e) => !e.hasProgressions).length;
    const avgCoverage = total > 0 ? Math.round(enriched.reduce((a, e) => a + e.mediaCoverageScore, 0) / total) : 0;

    res.json({
      exercises: enriched,
      stats: { total, fullyEnriched, missingVideo, missingCues, missingProgressions, avgCoverage },
    });
  });

  // ── POST /api/org/exercises/search-youtube ─────────────────────────────────────
  app.post("/api/org/exercises/search-youtube", requireCoach, async (req: any, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "query required" });

    const searchQuery = `${query} exercise tutorial demonstration site:youtube.com`;

    try {
      // Use OpenAI Responses API with web_search_preview
      const response = await (openai as any).responses.create({
        model: "gpt-4o",
        tools: [{ type: "web_search_preview" }],
        input: `Search YouTube for the best exercise demonstration video for: "${query}". Return the top 5 results as JSON array with fields: title, youtubeUrl (full youtube.com/watch?v= URL), channelName, description, thumbnailUrl (use https://i.ytimg.com/vi/{VIDEO_ID}/hqdefault.jpg). Ensure youtubeUrl is a real YouTube link. Only return the JSON array, no other text.`,
      });

      const text = response.output_text ?? "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const results = JSON.parse(jsonMatch[0]);
        return res.json({ results: results.slice(0, 6) });
      }
      return res.json({ results: [] });
    } catch {
      // Fallback: use chat completions to suggest known YouTube channels
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{
            role: "user",
            content: `Suggest 5 real YouTube exercise tutorial video URLs for "${query}". Format as JSON array: [{"title":"...", "youtubeUrl":"https://youtube.com/watch?v=REAL_ID", "channelName":"...", "description":"..."}]. Use well-known channels like Jeff Nippard, Alan Thrall, Mark Rippetoe, Juggernaut, Starting Strength. Return ONLY the JSON array.`,
          }],
          response_format: { type: "json_object" },
          max_tokens: 600,
        });
        const data = JSON.parse(completion.choices[0].message.content ?? "{}");
        const results = data.results ?? data.videos ?? [];
        return res.json({ results: results.slice(0, 6) });
      } catch {
        return res.json({ results: [] });
      }
    }
  });

  // ── POST /api/org/exercises/:id/auto-enrich ────────────────────────────────────
  app.post("/api/org/exercises/:id/auto-enrich", requireCoach, async (req: any, res) => {
    const { id } = req.params;
    const [ex] = await db.select().from(exerciseLibrary).where(eq(exerciseLibrary.id, id)).limit(1);
    if (!ex) return res.status(404).json({ error: "Exercise not found" });

    const prompt = `You are an expert S&C coach. Return coaching intelligence for the exercise "${ex.name}" as JSON.
Return: {
  "suggestedYoutubeSearch": "best search query for YouTube demo",
  "coachingCues": ["cue1","cue2","cue3","cue4","cue5"],
  "commonMistakes": ["mistake1","mistake2","mistake3"],
  "progressions": ["progression1","progression2"],
  "regressions": ["regression1","regression2"],
  "breathingCue": "single breath cue",
  "relatedExercises": ["related1","related2","related3"],
  "confidenceScore": 0.85
}`;

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 700,
      });
      const suggestion = JSON.parse(completion.choices[0].message.content ?? "{}");
      res.json({ suggestion, exerciseName: ex.name });
    } catch {
      res.status(500).json({ error: "Auto-enrichment failed" });
    }
  });

  // ── POST /api/org/exercises/:id/generate-cues ──────────────────────────────────
  app.post("/api/org/exercises/:id/generate-cues", requireCoach, async (req: any, res) => {
    const { id } = req.params;
    const { field } = req.body; // "coachingCues" | "commonMistakes" | "progressions" | "regressions" | "all"
    const [ex] = await db.select().from(exerciseLibrary).where(eq(exerciseLibrary.id, id)).limit(1);
    if (!ex) return res.status(404).json({ error: "Exercise not found" });

    const prompt = `You are an expert S&C coach. Generate coaching intelligence for "${ex.name}" (category: ${ex.category}, pattern: ${ex.movementPattern ?? "general"}).
Return JSON:
{
  "coachingCues": ["up to 5 coaching cues"],
  "commonMistakes": ["up to 3 common mistakes"],
  "progressions": ["up to 3 harder progressions"],
  "regressions": ["up to 3 easier regressions"]
}
Be specific, action-oriented, and practical. Short phrases only.`;

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 500,
      });
      const generated = JSON.parse(completion.choices[0].message.content ?? "{}");
      res.json({ generated });
    } catch {
      res.status(500).json({ error: "Generation failed" });
    }
  });

  // ── PATCH /api/org/exercises/:id — full exercise update ────────────────────────
  app.patch("/api/org/exercises/:id", requireCoach, async (req: any, res) => {
    const { orgId } = req._pbAuth;
    const { id } = req.params;
    const updates: any = {};
    const allowed = ["name", "description", "coachingCues", "commonMistakes", "progressions", "regressions",
      "youtubeUrl", "embeddedVideoUrl", "videoUrl", "gifUrl", "thumbnailUrl", "coachVoiceoverUrl", "demoType",
      "category", "movementPattern", "primaryMuscles", "secondaryMuscles", "equipment", "difficulty", "tags"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No updates" });

    const [updated] = await db.update(exerciseLibrary).set(updates)
      .where(or(
        and(eq(exerciseLibrary.id, id), eq(exerciseLibrary.orgId, orgId)),
        eq(exerciseLibrary.id, id),
      )).returning();
    res.json({ exercise: updated });
  });
}

// ── Helper: update streak after session completion ───────────────────────────
export async function updateAthleteStreak(orgId: string, athleteUserId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [existing] = await db.select().from(athleteStreaks)
    .where(and(eq(athleteStreaks.orgId, orgId), eq(athleteStreaks.athleteUserId, athleteUserId))).limit(1);

  if (!existing) {
    const [created] = await db.insert(athleteStreaks).values({
      orgId, athleteUserId,
      currentStreak: 1, longestStreak: 1,
      lastCompletedDate: new Date(),
      totalSessionsCompleted: 1,
    }).returning();
    return created;
  }

  const lastDate = existing.lastCompletedDate ? new Date(existing.lastCompletedDate) : null;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  let newStreak = 1;
  if (lastDate) {
    const lastDay = new Date(lastDate);
    lastDay.setHours(0, 0, 0, 0);
    if (lastDay.getTime() === today.getTime()) {
      newStreak = existing.currentStreak; // Already completed today
    } else if (lastDay.getTime() === yesterday.getTime()) {
      newStreak = existing.currentStreak + 1; // Consecutive day
    }
    // else streak resets to 1
  }

  const [updated] = await db.update(athleteStreaks).set({
    currentStreak: newStreak,
    longestStreak: Math.max(newStreak, existing.longestStreak),
    lastCompletedDate: new Date(),
    totalSessionsCompleted: existing.totalSessionsCompleted + 1,
    updatedAt: new Date(),
  }).where(eq(athleteStreaks.id, existing.id)).returning();

  return updated;
}
