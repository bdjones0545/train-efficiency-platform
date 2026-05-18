import type { Express } from "express";
import { db } from "./db";
import {
  nutritionModules, nutritionQuizQuestions,
  nutritionProgress, nutritionQuizAttempts, userProfiles,
} from "@shared/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import { triggerNotificationEvent } from "./services/notification-automation";
import { createActivityEvent } from "./services/activity-timeline";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function getUserId(req: any): string | null {
  return req.user?.claims?.sub ?? req.user?.id ?? null;
}

async function getOrgProfile(req: any) {
  const userId = getUserId(req);
  if (!userId) return null;
  const [p] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return p ?? null;
}

function requireAuth(req: any, res: any, next: any) {
  (async () => {
    const p = await getOrgProfile(req);
    if (!p) return res.status(401).json({ message: "Unauthorized" });
    (req as any)._profile = p;
    next();
  })().catch(() => res.status(500).json({ message: "Auth error" }));
}

function requireCoach(req: any, res: any, next: any) {
  (async () => {
    const p = await getOrgProfile(req);
    if (!p) return res.status(401).json({ message: "Unauthorized" });
    if (!["ADMIN", "COACH"].includes(p.role ?? "")) return res.status(403).json({ message: "Forbidden" });
    (req as any)._profile = p;
    next();
  })().catch(() => res.status(500).json({ message: "Auth error" }));
}

// ─── Default module seed data ─────────────────────────────────────────────────

const DEFAULT_MODULES = [
  {
    moduleNumber: 1,
    title: "Fueling Basics",
    description: "Understand how food powers your performance — from energy to consistency.",
    content: {
      sections: [
        {
          heading: "Calories = Energy",
          body: "Every movement, sprint, and lift your body does requires energy. That energy comes from food. Think of calories as the fuel in your tank — not enough fuel and your engine stalls; too little consistently and your performance and recovery both suffer.",
        },
        {
          heading: "Food Quality Matters",
          body: "Not all fuel is equal. Whole foods like lean proteins, fruits, vegetables, and complex carbs burn cleaner and keep you performing longer. Highly processed foods can spike energy short-term but leave you crashing when it matters most.",
        },
        {
          heading: "Consistency Is King",
          body: "Eating well one day doesn't make up for poor fueling the rest of the week. Your body responds to patterns. Consistently fueling well — especially around training — builds the foundation for real performance gains.",
        },
      ],
      keyTakeaways: [
        "Food is fuel — your performance depends on consistent, quality eating.",
        "Whole foods give your body cleaner, more sustained energy than processed options.",
        "Missing meals regularly — especially around training — will hurt recovery and output.",
      ],
    },
    questions: [
      {
        question: "What is the main role of calories in athletic performance?",
        options: ["They make you gain weight", "They provide the energy your body needs to move and recover", "They slow digestion", "They only matter for strength athletes"],
        correctAnswer: 1,
        explanation: "Calories are units of energy. Every movement, lift, and recovery process requires energy from food.",
      },
      {
        question: "Which of these is an example of a quality fuel source?",
        options: ["A bag of chips", "An energy drink", "Grilled chicken and rice", "Candy"],
        correctAnswer: 2,
        explanation: "Whole foods like lean proteins and complex carbs provide sustained energy and better recovery support.",
      },
      {
        question: "Why does consistency in eating matter for athletes?",
        options: ["It doesn't — one perfect day is enough", "It helps the body build performance patterns over time", "It mainly helps with mental focus", "Consistency only matters for endurance sports"],
        correctAnswer: 1,
        explanation: "Your body adapts to patterns. Consistently fueling well — especially around training — compounds over time into real performance gains.",
      },
    ],
  },
  {
    moduleNumber: 2,
    title: "Protein & Recovery",
    description: "Learn how protein rebuilds your muscles and why it's essential after every session.",
    content: {
      sections: [
        {
          heading: "What Protein Does",
          body: "Protein is the building block of muscle tissue. Every time you train, you create micro-tears in your muscles. Protein is what your body uses to repair and rebuild those muscles stronger than before. Without enough protein, you recover slower and adapt less.",
        },
        {
          heading: "Supporting Recovery",
          body: "Recovery doesn't just happen during sleep — it starts the moment your workout ends. Getting protein into your system within 30–60 minutes after training helps kickstart the muscle repair process when your body is most responsive.",
        },
        {
          heading: "Simple Protein Sources",
          body: "You don't need supplements to meet your protein needs. Everyday foods like eggs, chicken, turkey, fish, Greek yogurt, cottage cheese, beans, and lentils are all excellent sources. Mix and match throughout the day to hit your target.",
        },
      ],
      keyTakeaways: [
        "Protein repairs and rebuilds muscle tissue after training stress.",
        "Eating protein within 30–60 minutes post-training supports faster recovery.",
        "Whole food protein sources are reliable and effective — no supplements required.",
      ],
    },
    questions: [
      {
        question: "What is the primary role of protein for athletes?",
        options: ["Providing quick energy during workouts", "Repairing and rebuilding muscle tissue", "Replacing water lost in sweat", "Improving sleep quality"],
        correctAnswer: 1,
        explanation: "Protein repairs the micro-tears created during training, rebuilding muscle stronger than before.",
      },
      {
        question: "When is the best time to eat protein after training?",
        options: ["The next morning", "2–3 hours after the session", "Within 30–60 minutes post-training", "Only before bed"],
        correctAnswer: 2,
        explanation: "Your muscles are most responsive to protein in the 30–60 minute window after training — often called the 'anabolic window'.",
      },
      {
        question: "Which of these is a whole food protein source?",
        options: ["Protein bar with 25 ingredients", "Greek yogurt", "Sports drink", "White bread"],
        correctAnswer: 1,
        explanation: "Greek yogurt is a simple, whole food protein source packed with protein and probiotics.",
      },
      {
        question: "What happens if you consistently undertake protein intake?",
        options: ["Your performance stays the same", "You recover faster", "You recover slower and adapt less to training", "Nothing changes"],
        correctAnswer: 2,
        explanation: "Without adequate protein, your body can't fully repair muscle damage, leading to slower recovery and reduced adaptation.",
      },
    ],
  },
  {
    moduleNumber: 3,
    title: "Carbs for Performance",
    description: "Understand how carbohydrates fuel your training, games, and competitions.",
    content: {
      sections: [
        {
          heading: "Carbs Are Your Engine Fuel",
          body: "Carbohydrates are your body's preferred energy source during high-intensity exercise. They're stored in your muscles and liver as glycogen — and when you sprint, lift, or push hard, that's what you're burning. Running low on glycogen means running low on performance.",
        },
        {
          heading: "Pre-Workout Fueling",
          body: "Eating a carb-containing meal 2–3 hours before training tops up your glycogen stores so you have full fuel available. If you're training within 30–60 minutes, a quick carb snack like a banana or toast can provide a boost without weighing you down.",
        },
        {
          heading: "Game Day Basics",
          body: "Competition day nutrition should feel familiar. Stick to foods you've trained with — not new experiments. Focus on carbs you know digest well for you. Eat 2–3 hours before competition, stay hydrated, and avoid heavy or high-fat meals that slow digestion.",
        },
      ],
      keyTakeaways: [
        "Carbs are the primary fuel for high-intensity training and competition.",
        "Eating carbs 2–3 hours before training ensures your glycogen tank is full.",
        "Game day: keep it familiar, carb-focused, and well-timed.",
      ],
    },
    questions: [
      {
        question: "What is glycogen and why does it matter for athletes?",
        options: ["A type of protein that builds muscle", "Stored carbohydrate that fuels high-intensity performance", "A hormone that regulates sleep", "A fat source used during low-intensity activity"],
        correctAnswer: 1,
        explanation: "Glycogen is the stored form of carbohydrate in your muscles and liver — your primary fuel during sprints, lifts, and intense efforts.",
      },
      {
        question: "How long before training should you eat a full carb-containing meal?",
        options: ["Right before starting", "30 minutes before", "2–3 hours before", "The night before only"],
        correctAnswer: 2,
        explanation: "Eating 2–3 hours before training gives your body time to digest and convert food into available energy.",
      },
      {
        question: "What's a good quick carb option if you only have 30 minutes before training?",
        options: ["A large burger", "A full plate of pasta", "A banana or toast", "A protein bar"],
        correctAnswer: 2,
        explanation: "Simple carbs like a banana or toast digest quickly and provide a fast energy boost without causing discomfort during training.",
      },
      {
        question: "What should you avoid on game day from a nutrition standpoint?",
        options: ["Eating carbs", "Drinking water", "Trying new foods or high-fat meals", "Eating familiar foods"],
        correctAnswer: 2,
        explanation: "Game day is not the time to experiment. New foods or heavy, fatty meals can cause GI distress and slow you down.",
      },
    ],
  },
  {
    moduleNumber: 4,
    title: "Hydration & Electrolytes",
    description: "Stay sharp and powerful by learning how hydration drives athletic performance.",
    content: {
      sections: [
        {
          heading: "Daily Hydration",
          body: "Your body is roughly 60% water — and even mild dehydration (1–2% loss) can impair strength, speed, focus, and decision-making. Hydration isn't just a game-day concern. Consistently drinking enough water throughout the day is a daily performance habit.",
        },
        {
          heading: "Sweat Loss & Replacement",
          body: "During training, you lose water and electrolytes through sweat. Heavy sweaters or athletes training in heat lose significantly more. Sipping water before, during, and after sessions — rather than chugging at the end — keeps your performance more consistent.",
        },
        {
          heading: "Electrolytes Matter Too",
          body: "Sodium, potassium, and magnesium are key electrolytes lost in sweat. They regulate muscle contractions, nerve signals, and fluid balance. For most training sessions, water is enough. For long sessions (90+ minutes) or in hot conditions, an electrolyte source helps maintain balance.",
        },
      ],
      keyTakeaways: [
        "Even mild dehydration noticeably impacts strength, speed, and focus.",
        "Sip water consistently before, during, and after training — don't wait until you're thirsty.",
        "Electrolytes matter for longer sessions and hot conditions — sodium, potassium, magnesium.",
      ],
    },
    questions: [
      {
        question: "At what level of dehydration does performance start to decline?",
        options: ["10% body weight loss", "5% water loss", "1–2% body weight loss", "Only when you feel thirsty"],
        correctAnswer: 2,
        explanation: "Research shows performance drops are measurable at just 1–2% body weight lost through dehydration.",
      },
      {
        question: "Which of these is the best hydration strategy during training?",
        options: ["Drink nothing and catch up after", "Chug water at the end of practice", "Sip water consistently before, during, and after", "Only drink sports drinks"],
        correctAnswer: 2,
        explanation: "Consistent sipping maintains fluid balance better than trying to catch up after you're already dehydrated.",
      },
      {
        question: "Which are key electrolytes lost in sweat?",
        options: ["Vitamin C, D, and B12", "Sodium, potassium, and magnesium", "Iron, zinc, and calcium", "Protein and carbohydrates"],
        correctAnswer: 1,
        explanation: "Sodium, potassium, and magnesium are the primary electrolytes lost through sweat that affect muscle and nerve function.",
      },
      {
        question: "When might you need electrolytes beyond just water?",
        options: ["Any workout over 20 minutes", "Sessions lasting 90+ minutes or in hot conditions", "Only during competitions", "Only if you cramp"],
        correctAnswer: 1,
        explanation: "For most training, water is sufficient. Longer sessions or hot environments deplete electrolytes enough that replacement becomes important.",
      },
    ],
  },
  {
    moduleNumber: 5,
    title: "Meal Timing",
    description: "Learn when to eat to maximize your training, recovery, and daily energy.",
    content: {
      sections: [
        {
          heading: "Before Training",
          body: "Eating before training helps you train harder and feel better. Aim for a balanced meal 2–3 hours before, or a small carb snack 30–60 minutes before if that's all the time you have. Avoid training completely fasted unless it's a light session — your output will likely suffer.",
        },
        {
          heading: "After Training",
          body: "The post-training window is critical. Your muscles are primed to absorb nutrients and start rebuilding. Getting in both protein and carbs within 30–60 minutes of finishing supports muscle repair and replenishes glycogen stores. A simple combination like chicken and rice, eggs and toast, or a Greek yogurt and banana works well.",
        },
        {
          heading: "School-Day Planning",
          body: "For student-athletes, meal timing often clashes with practice schedules. If you have late afternoon practice, make sure lunch is substantial and include a small carb-rich snack before practice. Pack snacks. Don't rely on vending machines or skipping meals. Small consistent habits add up.",
        },
      ],
      keyTakeaways: [
        "Eat 2–3 hours before training for optimal fuel — or a quick carb snack if time is short.",
        "Post-training: get protein + carbs within 30–60 minutes to maximize recovery.",
        "Plan your school-day eating around your practice schedule — consistency beats perfection.",
      ],
    },
    questions: [
      {
        question: "What should you eat before training if you have 2–3 hours?",
        options: ["A high-fat, low-carb meal", "A balanced meal with protein, carbs, and vegetables", "Nothing — train fasted for best results", "Only water"],
        correctAnswer: 1,
        explanation: "A balanced meal 2–3 hours out provides sustained energy without GI discomfort during training.",
      },
      {
        question: "Why is the post-training window important?",
        options: ["It's when calories don't count", "Muscles are primed to absorb nutrients and begin recovery", "You should avoid eating after training", "It only matters for strength athletes"],
        correctAnswer: 1,
        explanation: "Post-training, your muscles are highly receptive to nutrients — this is when protein and carbs do the most work for recovery.",
      },
      {
        question: "What's a simple, effective post-training meal combo?",
        options: ["Pizza and soda", "Protein + carbs, like chicken and rice or eggs and toast", "A large salad with no protein", "Just a protein shake"],
        correctAnswer: 1,
        explanation: "Combining protein (for repair) and carbs (for glycogen replenishment) is the most effective post-training strategy.",
      },
      {
        question: "As a student-athlete, what's a smart strategy for late-afternoon practice?",
        options: ["Skip lunch to save calories for after practice", "Eat a big lunch and pack a small pre-practice snack", "Only eat dinner after practice", "Drink an energy drink 10 minutes before practice"],
        correctAnswer: 1,
        explanation: "A solid lunch plus a small carb-rich snack before practice keeps your energy up through late-day sessions.",
      },
    ],
  },
  {
    moduleNumber: 6,
    title: "Building Your Plate",
    description: "Practical strategies for balanced meals, smart snacks, and fueling on the go.",
    content: {
      sections: [
        {
          heading: "Balanced Meals",
          body: "A simple framework for building balanced athletic meals: half your plate with vegetables and fruits, a quarter with quality protein (chicken, fish, eggs, beans), and a quarter with complex carbs (rice, potatoes, whole grain bread, pasta). This isn't a rigid rule — it's a useful starting point to ensure variety and balance.",
        },
        {
          heading: "Smart Snacks",
          body: "Snacks bridge the gap between meals and keep energy stable. Performance-focused snacks include: fruit with nut butter, Greek yogurt with granola, whole grain crackers and cheese, hard-boiled eggs, or trail mix. Snacks aren't cheating — they're strategy.",
        },
        {
          heading: "Travel & Game-Day Choices",
          body: "On the road, control what you can. Pack snacks you know work for you. When eating out, look for familiar proteins and carbs — a grilled chicken sandwich, rice bowl, or pasta dish. Avoid greasy or unfamiliar foods before competition. Stay hydrated regardless of environment.",
        },
      ],
      keyTakeaways: [
        "Use the plate method: half vegetables/fruit, quarter protein, quarter carbs.",
        "Snacks are strategic — plan them like a meal, not an afterthought.",
        "Travel nutrition: pack your own, choose familiar foods, stay hydrated.",
      ],
    },
    questions: [
      {
        question: "Using the plate method, how much of your plate should be protein?",
        options: ["Half the plate", "The whole plate", "About a quarter of the plate", "No more than 10%"],
        correctAnswer: 2,
        explanation: "The plate method suggests roughly a quarter of your plate for quality protein — enough to support recovery without crowding out carbs and vegetables.",
      },
      {
        question: "Which of these is a performance-focused snack?",
        options: ["Chips and a soda", "Fruit with nut butter or Greek yogurt", "Candy bar", "Fast food fries"],
        correctAnswer: 1,
        explanation: "Fruit with nut butter or Greek yogurt provides a balanced mix of carbs, protein, and healthy fats to fuel and recover.",
      },
      {
        question: "What's the best strategy for eating well when traveling for competition?",
        options: ["Skip meals to save energy", "Try lots of new local foods the night before", "Pack familiar snacks and choose simple, familiar proteins and carbs when eating out", "Only eat fast food"],
        correctAnswer: 2,
        explanation: "Traveling with familiar foods and making simple choices reduces GI risk and keeps your fueling consistent with what worked in training.",
      },
      {
        question: "Why are strategic snacks important for athletes?",
        options: ["They replace meals entirely", "They bridge energy gaps between meals and prevent performance dips", "They're only useful for weight gain", "Snacks are never needed for athletes"],
        correctAnswer: 1,
        explanation: "Well-timed snacks maintain stable energy throughout the day, especially for athletes with multiple sessions or long school-day schedules.",
      },
    ],
  },
];

// ─── Seed helper ──────────────────────────────────────────────────────────────

async function ensureDefaultModules(): Promise<void> {
  const existing = await db.select().from(nutritionModules)
    .where(and(eq(nutritionModules.isDefault, true)))
    .limit(1);
  if (existing.length > 0) return; // already seeded

  for (const mod of DEFAULT_MODULES) {
    const { questions, ...moduleData } = mod;
    const { content, ...rest } = moduleData;
    const [inserted] = await db.insert(nutritionModules).values({
      ...rest,
      content: content as any,
      isDefault: true,
      orgId: null,
    }).returning();
    for (const q of questions) {
      await db.insert(nutritionQuizQuestions).values({
        moduleId: inserted.id,
        question: q.question,
        options: q.options as any,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
      });
    }
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerNutritionRoutes(app: Express) {
  // Ensure modules are seeded on startup
  ensureDefaultModules().catch((e) => console.error("[nutrition] seed error:", e));

  // ── GET /api/org/nutrition/modules — list modules with progress ──────────
  app.get("/api/org/nutrition/modules", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      const userId = profile.userId;

      // Get all default modules + org-specific overrides
      const modules = await db.select().from(nutritionModules)
        .where(eq(nutritionModules.isDefault, true))
        .orderBy(nutritionModules.moduleNumber);

      if (modules.length === 0) {
        await ensureDefaultModules();
      }

      const reloaded = modules.length === 0
        ? await db.select().from(nutritionModules)
            .where(eq(nutritionModules.isDefault, true))
            .orderBy(nutritionModules.moduleNumber)
        : modules;

      // Get this athlete's progress
      const progRows = await db.select().from(nutritionProgress)
        .where(and(eq(nutritionProgress.orgId, orgId), eq(nutritionProgress.athleteUserId, userId)));
      const progMap = Object.fromEntries(progRows.map((p) => [p.moduleId, p]));

      // Attach progress to each module
      const result = reloaded.map((m, idx) => ({
        ...m,
        progress: progMap[m.id] ?? { status: "not_started", quizScore: null, completedAt: null },
      }));

      // Overall stats
      const completed = result.filter((m) => m.progress.status === "completed").length;
      const inProgress = result.filter((m) => m.progress.status === "in_progress").length;

      res.json({
        modules: result,
        stats: {
          total: result.length,
          completed,
          inProgress,
          notStarted: result.length - completed - inProgress,
          percentComplete: Math.round((completed / Math.max(result.length, 1)) * 100),
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/nutrition/modules/:moduleId/questions — fetch quiz ──────
  app.get("/api/org/nutrition/modules/:moduleId/questions", requireAuth, async (req: any, res) => {
    try {
      const { moduleId } = req.params;
      const questions = await db.select().from(nutritionQuizQuestions)
        .where(eq(nutritionQuizQuestions.moduleId, moduleId));
      // Strip correctAnswer from athlete-facing response
      const sanitized = questions.map(({ correctAnswer, explanation, ...rest }) => rest);
      res.json(sanitized);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/nutrition/progress — athlete's full progress summary ────
  app.get("/api/org/nutrition/progress", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const rows = await db.select().from(nutritionProgress)
        .where(and(
          eq(nutritionProgress.orgId, profile.organizationId),
          eq(nutritionProgress.athleteUserId, profile.userId),
        ));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/nutrition/modules/:moduleId/start ──────────────────────
  app.post("/api/org/nutrition/modules/:moduleId/start", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { moduleId } = req.params;

      // Upsert progress row
      const existing = await db.select().from(nutritionProgress).where(
        and(
          eq(nutritionProgress.orgId, profile.organizationId),
          eq(nutritionProgress.athleteUserId, profile.userId),
          eq(nutritionProgress.moduleId, moduleId),
        )
      ).limit(1);

      if (existing.length === 0) {
        await db.insert(nutritionProgress).values({
          orgId: profile.organizationId,
          athleteUserId: profile.userId,
          moduleId,
          status: "in_progress",
        });
      } else if (existing[0].status === "not_started") {
        await db.update(nutritionProgress)
          .set({ status: "in_progress", updatedAt: new Date() })
          .where(eq(nutritionProgress.id, existing[0].id));
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/nutrition/modules/:moduleId/quiz ───────────────────────
  app.post("/api/org/nutrition/modules/:moduleId/quiz", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { moduleId } = req.params;
      const { answers } = z.object({ answers: z.array(z.number()) }).parse(req.body);

      // Get correct answers
      const questions = await db.select().from(nutritionQuizQuestions)
        .where(eq(nutritionQuizQuestions.moduleId, moduleId))
        .orderBy(nutritionQuizQuestions.id);

      if (questions.length === 0) {
        return res.status(404).json({ message: "No questions found for this module" });
      }

      // Score
      let correct = 0;
      const results = questions.map((q, idx) => {
        const isCorrect = answers[idx] === q.correctAnswer;
        if (isCorrect) correct++;
        return {
          questionId: q.id,
          question: q.question,
          options: q.options,
          yourAnswer: answers[idx] ?? -1,
          correctAnswer: q.correctAnswer,
          isCorrect,
          explanation: q.explanation,
        };
      });

      const score = Math.round((correct / questions.length) * 100);
      const passed = score >= 80;

      // Log attempt
      await db.insert(nutritionQuizAttempts).values({
        orgId: profile.organizationId,
        athleteUserId: profile.userId,
        moduleId,
        answers: answers as any,
        score,
        passed,
      });

      // Update progress
      const existing = await db.select().from(nutritionProgress).where(
        and(
          eq(nutritionProgress.orgId, profile.organizationId),
          eq(nutritionProgress.athleteUserId, profile.userId),
          eq(nutritionProgress.moduleId, moduleId),
        )
      ).limit(1);

      const newStatus = passed ? "completed" : "in_progress";
      const completedAt = passed ? new Date() : null;

      if (existing.length === 0) {
        await db.insert(nutritionProgress).values({
          orgId: profile.organizationId,
          athleteUserId: profile.userId,
          moduleId,
          status: newStatus,
          quizScore: score,
          completedAt,
        });
      } else {
        // Only update to completed if passing (don't downgrade)
        const shouldComplete = passed && existing[0].status !== "completed";
        await db.update(nutritionProgress).set({
          status: existing[0].status === "completed" ? "completed" : newStatus,
          quizScore: score,
          completedAt: existing[0].completedAt ?? completedAt,
          updatedAt: new Date(),
        }).where(eq(nutritionProgress.id, existing[0].id));
      }

      // Notification hooks (fire and forget)
      if (passed) {
        // Check if pathway complete
        const allModules = await db.select().from(nutritionModules)
          .where(eq(nutritionModules.isDefault, true));
        const allProgress = await db.select().from(nutritionProgress)
          .where(and(
            eq(nutritionProgress.orgId, profile.organizationId),
            eq(nutritionProgress.athleteUserId, profile.userId),
          ));
        const completedIds = new Set(allProgress.filter((p) => p.status === "completed").map((p) => p.moduleId));
        const allDone = allModules.every((m) => completedIds.has(m.id));

        triggerNotificationEvent("nutrition_module_completed" as any, {
          orgId: profile.organizationId,
          userId: profile.userId,
          moduleId,
          score,
          allPathwayComplete: allDone,
        }).catch(() => {});

        if (allDone) {
          triggerNotificationEvent("nutrition_pathway_completed" as any, {
            orgId: profile.organizationId,
            userId: profile.userId,
          }).catch(() => {});
        }

        createActivityEvent({
          orgId: profile.organizationId,
          userId: profile.userId,
          sourceType: "system",
          sourceId: moduleId,
          eventType: "nutrition_module_completed",
          title: `Nutrition module completed${allDone ? " — Pathway complete! 🎉" : ""}`,
          description: `Passed with ${score}%${allDone ? " — All 6 modules complete!" : ""}`,
          metadata: { moduleId, score, passed, allDone, severity: "positive" },
          visibility: "athlete",
        }).catch(() => {});
      } else {
        // Check fail count
        const attempts = await db.select().from(nutritionQuizAttempts).where(
          and(
            eq(nutritionQuizAttempts.orgId, profile.organizationId),
            eq(nutritionQuizAttempts.athleteUserId, profile.userId),
            eq(nutritionQuizAttempts.moduleId, moduleId),
            eq(nutritionQuizAttempts.passed, false),
          )
        );
        if (attempts.length >= 2) {
          triggerNotificationEvent("nutrition_quiz_failed" as any, {
            orgId: profile.organizationId,
            userId: profile.userId,
            moduleId,
            failCount: attempts.length,
          }).catch(() => {});
        }
      }

      res.json({ score, passed, results, correct, total: questions.length });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // ── Coach: GET /api/org/coach/nutrition/progress — org-wide progress ─────
  app.get("/api/org/coach/nutrition/progress", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;

      const modules = await db.select().from(nutritionModules)
        .where(eq(nutritionModules.isDefault, true))
        .orderBy(nutritionModules.moduleNumber);

      const allProgress = await db.select().from(nutritionProgress)
        .where(eq(nutritionProgress.orgId, orgId));

      // Aggregate per module
      const moduleStats = modules.map((m) => {
        const rows = allProgress.filter((p) => p.moduleId === m.id);
        const completed = rows.filter((p) => p.status === "completed").length;
        const inProg = rows.filter((p) => p.status === "in_progress").length;
        const avgScore = rows.filter((p) => p.quizScore !== null).length > 0
          ? Math.round(rows.filter((p) => p.quizScore !== null)
              .reduce((s, p) => s + (p.quizScore ?? 0), 0) / rows.filter((p) => p.quizScore !== null).length)
          : null;
        return { module: m, completed, inProgress: inProg, started: rows.length, avgScore };
      });

      // Unique athlete IDs with any progress
      const athleteIds = [...new Set(allProgress.map((p) => p.athleteUserId))];
      const pathwayComplete = athleteIds.filter((aid) => {
        const done = new Set(allProgress.filter((p) => p.athleteUserId === aid && p.status === "completed").map((p) => p.moduleId));
        return modules.every((m) => done.has(m.id));
      }).length;

      res.json({
        moduleStats,
        totalAthletes: athleteIds.length,
        pathwayComplete,
        notStarted: 0, // would need org membership count
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Coach: GET /api/org/coach/nutrition/athlete/:userId ──────────────────
  app.get("/api/org/coach/nutrition/athlete/:userId", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { userId } = req.params;

      const modules = await db.select().from(nutritionModules)
        .where(eq(nutritionModules.isDefault, true))
        .orderBy(nutritionModules.moduleNumber);

      const progRows = await db.select().from(nutritionProgress)
        .where(and(
          eq(nutritionProgress.orgId, profile.organizationId),
          eq(nutritionProgress.athleteUserId, userId),
        ));
      const progMap = Object.fromEntries(progRows.map((p) => [p.moduleId, p]));

      const attempts = await db.select().from(nutritionQuizAttempts)
        .where(and(
          eq(nutritionQuizAttempts.orgId, profile.organizationId),
          eq(nutritionQuizAttempts.athleteUserId, userId),
        ))
        .orderBy(desc(nutritionQuizAttempts.createdAt));

      const latest = attempts[0] ?? null;
      const completed = Object.values(progMap).filter((p) => p.status === "completed").length;

      res.json({
        modules: modules.map((m) => ({
          ...m,
          progress: progMap[m.id] ?? { status: "not_started", quizScore: null },
        })),
        stats: {
          completed,
          total: modules.length,
          percentComplete: Math.round((completed / Math.max(modules.length, 1)) * 100),
          latestScore: latest?.score ?? null,
          lastActivity: latest?.createdAt ?? null,
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
