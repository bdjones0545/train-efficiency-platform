import { db } from "./db";
import { educationPathways, educationModules, educationQuizQuestions, educationBadges } from "@shared/schema";
import { eq, and } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContentSection {
  title: string;
  body: string;
}

interface ModuleSeed {
  moduleNumber: number;
  title: string;
  description: string;
  estimatedMinutes: number;
  content: { sections: ContentSection[] };
  keyTakeaways: string[];
  quiz: {
    question: string;
    options: string[];
    correctAnswer: number;
    explanation: string;
  }[];
}

interface PathwaySeed {
  id: string;
  title: string;
  slug: string;
  category: string;
  description: string;
  modules: ModuleSeed[];
}

// ─── Default Pathway Library ──────────────────────────────────────────────────

const DEFAULT_PATHWAYS: PathwaySeed[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // 1. NUTRITION FOUNDATIONS
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "default-pathway-nutrition",
    title: "Nutrition Foundations",
    slug: "nutrition-foundations",
    category: "nutrition",
    description: "Build a strong understanding of how food fuels athletic performance. This pathway covers macronutrients, meal timing, pre- and post-workout fueling, and game-day strategies — all from an education-first perspective. Not medical or dietary advice.",
    modules: [
      {
        moduleNumber: 1,
        title: "Why Athletes Eat Differently",
        description: "Understand how athletic training changes your body's energy demands and why fueling intentionally matters.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "Your Body Is a High-Performance Engine",
              body: "When you train hard, your body burns through energy reserves, breaks down muscle tissue, and stresses your cardiovascular and nervous systems. Unlike a sedentary person, an athlete's nutritional needs are elevated — not just in calories, but in specific nutrients that support recovery, muscle repair, and sustained output. Ignoring these needs leads to fatigue, slower gains, and a higher risk of injury."
            },
            {
              title: "Energy Balance in Athletes",
              body: "Energy balance is the relationship between the calories you consume and the calories you burn. Athletes often need to consume significantly more than the average person to maintain performance. Under-fueling — sometimes called energy deficiency — impairs performance, disrupts hormones, weakens bones, and slows recovery. Understanding that food is fuel, not just preference, is the first mindset shift every athlete needs to make."
            },
            {
              title: "Nutrition Is Not a Diet",
              body: "Many athletes confuse sports nutrition with dieting or restriction. Performance nutrition is about giving your body what it needs to train, compete, and recover. The goal is not weight loss or eating less — it's strategic fueling. That said, individual needs vary widely based on sport, training volume, body size, and goals. The key is consistent, quality fueling over time."
            },
            {
              title: "The Foundation: Consistency Over Perfection",
              body: "No single meal determines your performance. What matters most is your day-to-day pattern of eating. Athletes who fuel consistently — eating regular meals and snacks, prioritizing whole foods, and not skipping meals — almost always outperform athletes who eat randomly or skip meals before or after training. Build the habit first; optimize the details later."
            }
          ]
        },
        keyTakeaways: [
          "Athletes have higher energy and nutrient demands than sedentary individuals.",
          "Under-fueling hurts performance, recovery, and long-term health.",
          "Sports nutrition is about strategic fueling — not restriction or dieting.",
          "Consistent daily eating habits matter more than any single perfect meal."
        ],
        quiz: [
          {
            question: "Why do athletes generally need to eat more than non-athletes?",
            options: [
              "Because athletes have faster metabolisms due to genetics",
              "Because training increases energy demands, muscle breakdown, and recovery needs",
              "Because athletes need to gain weight for strength sports",
              "Because exercise reduces the efficiency of digestion"
            ],
            correctAnswer: 1,
            explanation: "Training burns more energy and triggers muscle breakdown, which increases overall nutrient and calorie requirements for repair and performance."
          },
          {
            question: "What is 'energy deficiency' in athletes?",
            options: [
              "Eating too much sugar before a game",
              "Not sleeping enough before competition",
              "Consistently consuming fewer calories than training demands require",
              "Running out of energy during a single workout"
            ],
            correctAnswer: 2,
            explanation: "Energy deficiency occurs when an athlete chronically under-fuels relative to their training load, leading to impaired performance, hormonal disruption, and slower recovery."
          },
          {
            question: "Which statement best describes sports nutrition?",
            options: [
              "It is a strict diet plan designed to minimize body weight",
              "It is strategic fueling to support training, competition, and recovery",
              "It involves avoiding carbohydrates to improve body composition",
              "It only matters for professional athletes"
            ],
            correctAnswer: 1,
            explanation: "Sports nutrition focuses on providing the right nutrients at the right times to support an athlete's performance and recovery — not restriction."
          },
          {
            question: "What is the most important factor in an athlete's daily nutrition?",
            options: [
              "Eating the exact same foods every day",
              "Taking the right supplements after every workout",
              "Consistent, quality fueling habits over time",
              "Avoiding all processed foods completely"
            ],
            correctAnswer: 2,
            explanation: "Consistency in daily eating patterns — regular meals, quality foods, and not skipping meals — drives better performance outcomes than any single perfect meal."
          }
        ]
      },
      {
        moduleNumber: 2,
        title: "Macronutrients for Athletes",
        description: "Learn how carbohydrates, proteins, and fats each play a specific role in athletic performance and recovery.",
        estimatedMinutes: 12,
        content: {
          sections: [
            {
              title: "The Three Macronutrients",
              body: "All food is made up of three macronutrients — carbohydrates, protein, and fat. Each provides energy (measured in calories) and serves distinct roles in your body. Understanding what each does helps you make smarter fueling decisions without needing to obsessively count every gram."
            },
            {
              title: "Carbohydrates: Your Primary Fuel Source",
              body: "Carbohydrates are the body's preferred energy source during high-intensity exercise. When you eat carbs, they are broken down into glucose, which is stored in your muscles and liver as glycogen. During training, your muscles burn through glycogen rapidly. When glycogen runs low, performance drops, focus fades, and fatigue sets in early. Foods like rice, pasta, bread, oats, potatoes, and fruit are all carbohydrate sources that support athletic performance."
            },
            {
              title: "Protein: Building and Repairing Muscle",
              body: "Protein is made up of amino acids, which serve as the building blocks for muscle tissue. Exercise — especially strength training — causes microscopic damage to muscle fibers. Protein consumed after training is used to repair and build those fibers back stronger. Athletes generally need more protein per pound of bodyweight than sedentary individuals. Chicken, fish, eggs, beef, Greek yogurt, and legumes are all strong protein sources."
            },
            {
              title: "Fat: Sustained Energy and Essential Functions",
              body: "Dietary fat plays a critical role in hormone production, vitamin absorption, joint lubrication, and providing sustained energy during lower-intensity activity. Fat is not the enemy — it is essential. The key is prioritizing healthy fat sources like avocado, nuts, olive oil, and fatty fish. Fat is calorie-dense, so a little goes a long way in meeting energy needs."
            }
          ]
        },
        keyTakeaways: [
          "Carbohydrates are the primary fuel for high-intensity training — don't avoid them.",
          "Protein repairs and builds muscle tissue after training.",
          "Fat supports hormones, joint health, and sustained energy.",
          "All three macronutrients matter — balance is key for performance."
        ],
        quiz: [
          {
            question: "Which macronutrient is the primary fuel source during high-intensity exercise?",
            options: ["Fat", "Protein", "Carbohydrates", "Vitamins"],
            correctAnswer: 2,
            explanation: "Carbohydrates are broken down into glucose and stored as glycogen, which muscles burn during intense exercise. Fat becomes more dominant only at lower intensities."
          },
          {
            question: "What happens when glycogen stores run low during training?",
            options: [
              "Muscles switch to using protein for energy only",
              "Performance drops, fatigue increases, and mental focus fades",
              "The body automatically produces more glucose from water",
              "Athletes experience no effect if they are well-rested"
            ],
            correctAnswer: 1,
            explanation: "When glycogen runs low, the body struggles to maintain intensity, leading to early fatigue, reduced power output, and mental fog."
          },
          {
            question: "Why is protein especially important after a strength training session?",
            options: [
              "It provides immediate energy to finish the workout",
              "It hydrates muscles after sweating",
              "It supplies amino acids to repair and rebuild muscle tissue damaged during training",
              "It replaces glycogen stores faster than carbohydrates"
            ],
            correctAnswer: 2,
            explanation: "Strength training causes microscopic muscle damage. Protein supplies the amino acids needed to repair those fibers and build them back stronger — the process that leads to muscle growth."
          },
          {
            question: "Which of the following is a healthy source of dietary fat for athletes?",
            options: [
              "White bread and pasta",
              "Avocados and olive oil",
              "Candy and sugar-sweetened beverages",
              "Lean chicken breast"
            ],
            correctAnswer: 1,
            explanation: "Avocados, olive oil, nuts, and fatty fish are healthy fat sources that support hormones, joint health, and sustained energy — unlike highly processed fats."
          },
          {
            question: "Which statement about fat in an athlete's diet is accurate?",
            options: [
              "Fat should be eliminated to improve body composition",
              "Fat only matters for endurance athletes",
              "Fat is essential for hormone production, vitamin absorption, and joint health",
              "Fat has no role in energy production"
            ],
            correctAnswer: 2,
            explanation: "Dietary fat is essential — it supports hormone production, enables fat-soluble vitamin absorption, lubricates joints, and provides sustained energy during lower-intensity activity."
          }
        ]
      },
      {
        moduleNumber: 3,
        title: "Pre-Workout Fueling",
        description: "Understand what to eat and when to eat it before training to maximize energy, focus, and performance.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "The Goal of Pre-Workout Nutrition",
              body: "The purpose of eating before training is simple: top off your glycogen stores, provide amino acids to reduce muscle breakdown during exercise, and make sure you're not training on an empty tank. Training fasted or underfueled leads to earlier fatigue, reduced strength output, and impaired focus — none of which help you make progress."
            },
            {
              title: "What to Eat Before Training",
              body: "A good pre-workout meal or snack should be primarily carbohydrate-based with a moderate amount of protein. It should be easy to digest. High-fat and high-fiber foods take longer to digest and can cause discomfort during exercise — so save the big salads and heavy sauces for after training. Examples: oatmeal with fruit, rice and chicken, a banana with peanut butter, or a sports drink and a granola bar if timing is tight."
            },
            {
              title: "Timing Matters",
              body: "Aim to eat a full meal 2–3 hours before training. If you're working out in under an hour, opt for a smaller, easy-to-digest snack like a banana, sports drink, or a small portion of fruit and crackers. Eating too close to training with a large, heavy meal can cause cramping, sluggishness, and nausea. Plan ahead — don't wing it on game day or heavy training days."
            },
            {
              title: "Caffeine as a Performance Tool (Education Only)",
              body: "Caffeine is one of the most researched and effective ergogenic aids in sports. It can enhance focus, reduce perceived exertion, and delay fatigue. However, it is not appropriate for all athletes — especially younger athletes whose nervous systems are still developing. Individual tolerance varies widely. This module is provided for awareness, not as a recommendation. Speak with appropriate health professionals before adding any supplement to your routine."
            }
          ]
        },
        keyTakeaways: [
          "Eat before training to top off glycogen, protect muscle, and sustain focus.",
          "Prioritize carbohydrates and moderate protein — keep fat and fiber low pre-workout.",
          "Eat a full meal 2–3 hours out; have a small snack if training is under 60 minutes away.",
          "Plan ahead for early-morning sessions and game days so you're not scrambling."
        ],
        quiz: [
          {
            question: "What is the primary goal of pre-workout nutrition?",
            options: [
              "To add as many calories as possible before burning them off",
              "To top off glycogen stores and fuel the upcoming training session",
              "To avoid eating so the body burns stored fat during exercise",
              "To consume as much protein as possible for muscle growth"
            ],
            correctAnswer: 1,
            explanation: "Pre-workout nutrition ensures glycogen stores are topped off, muscle breakdown is reduced, and the athlete has the energy and focus needed to train effectively."
          },
          {
            question: "Which food would be the best choice as a small pre-workout snack 45 minutes before training?",
            options: [
              "A large salad with beans, cheese, and dressing",
              "A bacon cheeseburger",
              "A banana and a small handful of crackers",
              "A high-protein meal with steak and broccoli"
            ],
            correctAnswer: 2,
            explanation: "Close to training, you want something easy to digest with simple carbohydrates. High-fat, high-fiber foods take too long to digest and can cause GI discomfort during exercise."
          },
          {
            question: "How far in advance should a full pre-workout meal ideally be consumed?",
            options: [
              "30 minutes before training",
              "2–3 hours before training",
              "Immediately before training",
              "The night before training"
            ],
            correctAnswer: 1,
            explanation: "A full meal takes 2–3 hours to digest properly. Eating too close to training with a large meal can cause cramping, sluggishness, and poor performance."
          },
          {
            question: "Why should high-fat foods be limited before training?",
            options: [
              "Fat causes muscle cramps during exercise",
              "Fat reduces blood sugar levels too quickly",
              "Fat takes longer to digest and can cause discomfort during exercise",
              "Fat cannot be used as energy at all"
            ],
            correctAnswer: 2,
            explanation: "Fat is digested slowly, which means eating large amounts before training can leave you feeling sluggish and can cause gastrointestinal discomfort during exercise."
          }
        ]
      },
      {
        moduleNumber: 4,
        title: "Post-Workout Recovery Nutrition",
        description: "Learn why what you eat after training is just as important as the session itself — and how to make the most of the recovery window.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "The Anabolic Window: Real but Flexible",
              body: "You've probably heard that you need to eat immediately after training or you'll 'lose your gains.' The truth is more nuanced. Your body does enter a heightened state of nutrient sensitivity after exercise — muscle cells are primed to absorb nutrients more efficiently. However, the window is not a narrow 30-minute cliff. For most athletes, consuming quality nutrition within 1–2 hours after training is sufficient to support recovery."
            },
            {
              title: "The Post-Workout Plate: Carbs + Protein",
              body: "The two most important post-workout priorities are (1) refilling glycogen stores with carbohydrates and (2) supplying amino acids for muscle repair with protein. A common framework is a 3:1 or 4:1 ratio of carbohydrates to protein — for example, 60–80g of carbs with 20–30g of protein. This could look like a chicken and rice bowl, Greek yogurt with fruit and granola, a turkey sandwich, or a protein shake with a banana."
            },
            {
              title: "Don't Skip Recovery Meals",
              body: "One of the most common mistakes athletes make is training hard and then skipping the post-workout meal because they're not hungry, they're rushing, or they're trying to 'keep calories down.' This is counterproductive. Without adequate post-workout nutrition, muscle protein synthesis is impaired, glycogen replenishment stalls, and you'll feel more fatigued heading into your next session. Recovery nutrition is not optional — it's part of training."
            },
            {
              title: "Hydration Is Part of Recovery Too",
              body: "You lose water and electrolytes through sweat during training. Rehydrating after exercise helps restore blood volume, supports nutrient transport, and reduces next-day soreness. A general rule: drink 16–24 oz of water for every pound of bodyweight lost during training. You can track this by weighing yourself before and after long, intense sessions."
            }
          ]
        },
        keyTakeaways: [
          "Consume carbohydrates and protein within 1–2 hours after training to support recovery.",
          "A rough target: 3–4g of carbs for every 1g of protein post-workout.",
          "Skipping post-workout nutrition impairs muscle repair and glycogen replenishment.",
          "Rehydrate after training — water loss through sweat must be replaced."
        ],
        quiz: [
          {
            question: "What are the two most important nutritional priorities after a training session?",
            options: [
              "Fat and fiber",
              "Vitamins and minerals",
              "Carbohydrates and protein",
              "Water and caffeine"
            ],
            correctAnswer: 2,
            explanation: "Carbohydrates refill glycogen stores depleted during training, while protein provides amino acids for muscle repair and growth. Both are critical post-workout."
          },
          {
            question: "Why is it a mistake to skip the post-workout meal to 'keep calories down'?",
            options: [
              "It causes immediate muscle loss",
              "It impairs muscle repair, glycogen replenishment, and readiness for the next session",
              "It reduces the effectiveness of the workout that was just completed",
              "It leads to immediate dehydration"
            ],
            correctAnswer: 1,
            explanation: "Without post-workout nutrition, your body cannot efficiently repair muscle or replenish energy stores, leaving you more fatigued and less prepared for the next training session."
          },
          {
            question: "Which of the following is a good example of a post-workout meal?",
            options: [
              "A large bag of chips and a soda",
              "Plain water and a cup of coffee",
              "A chicken and rice bowl with vegetables",
              "A fatty burger with no bun"
            ],
            correctAnswer: 2,
            explanation: "Chicken provides protein for muscle repair; rice provides carbohydrates to replenish glycogen. This combination covers the two primary post-workout nutritional priorities."
          },
          {
            question: "Approximately how much extra water should athletes consume for every pound of bodyweight lost through sweat?",
            options: [
              "4–8 oz",
              "16–24 oz",
              "32–48 oz",
              "8 oz exactly"
            ],
            correctAnswer: 1,
            explanation: "A general guideline is to drink 16–24 oz of water for every pound lost during training to restore hydration status and support recovery."
          }
        ]
      },
      {
        moduleNumber: 5,
        title: "Game Day Fueling",
        description: "Build a repeatable, practical game day nutrition plan that keeps you energized and performing from warm-up through final whistle.",
        estimatedMinutes: 8,
        content: {
          sections: [
            {
              title: "Game Day Is Not the Day to Experiment",
              body: "The number one rule of game day nutrition: don't try anything new. Stick to foods you know work well for your body. Athletes who experiment with new foods, supplements, or meal timing on competition day often pay for it with GI distress, sluggishness, or energy crashes. Build your game day routine in practice first."
            },
            {
              title: "The Night Before",
              body: "Game day nutrition starts the night before. A carbohydrate-rich dinner — pasta, rice, potatoes — combined with a quality protein source helps top off glycogen stores going into competition. Keep fat and fiber moderate to avoid feeling heavy or bloated. Get to bed at a consistent time to support rest and hormone regulation."
            },
            {
              title: "Morning of Competition",
              body: "If competition is in the afternoon or evening: eat a balanced breakfast with carbohydrates, protein, and moderate fat 3–4 hours out. If competition is in the morning: prioritize a quick, easily digestible carbohydrate-focused snack 60–90 minutes before. Avoid trying to eat a large meal close to competition. Hydrate consistently throughout the morning — don't wait until you're thirsty."
            },
            {
              title: "During and Between Events",
              body: "For competitions lasting 60+ minutes or events with multiple rounds, keeping energy topped off matters. Sports drinks, bananas, and easy-to-digest snacks can help maintain blood sugar and keep you focused. Between games or events, prioritize quick carbohydrates and fluids over heavy protein or fat, which takes longer to process."
            }
          ]
        },
        keyTakeaways: [
          "Never try new foods or supplements on game day — stick to what you know.",
          "Start game day nutrition the night before with a carbohydrate-focused dinner.",
          "Eat a pre-competition meal 2–4 hours before — smaller and simpler if time is short.",
          "During long competitions, maintain energy with quick carbohydrates and fluids."
        ],
        quiz: [
          {
            question: "What is the most important rule of game day nutrition?",
            options: [
              "Eat as much protein as possible the morning of competition",
              "Never eat anything before a game to avoid cramping",
              "Do not try any new foods, supplements, or timing strategies on game day",
              "Drink at least 1 gallon of water before the game"
            ],
            correctAnswer: 2,
            explanation: "Trying something new on game day risks GI issues, energy crashes, or discomfort. Stick to foods and routines that have already been tested in practice."
          },
          {
            question: "What type of meal is recommended the night before competition?",
            options: [
              "A high-fat, low-carb meal to maximize energy stores",
              "A carbohydrate-rich meal with quality protein to top off glycogen",
              "A light salad to avoid feeling heavy",
              "No meal — fasting the night before improves focus"
            ],
            correctAnswer: 1,
            explanation: "Glycogen stores are built up over time. A carbohydrate-rich dinner the night before helps top off those stores so you start competition fully fueled."
          },
          {
            question: "Why should athletes focus on quick carbohydrates rather than protein or fat between events?",
            options: [
              "Carbohydrates are the only nutrient that can be absorbed during activity",
              "Protein and fat provide no energy benefit",
              "Quick carbohydrates replenish blood sugar faster; protein and fat take longer to digest",
              "Carbohydrates prevent muscle soreness better than protein"
            ],
            correctAnswer: 2,
            explanation: "Between events, the priority is restoring blood sugar and muscle glycogen quickly. Protein and fat are digested slowly and can cause GI discomfort if consumed close to competition."
          }
        ]
      }
    ]
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 2. RECOVERY & SLEEP
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "default-pathway-recovery",
    title: "Recovery & Sleep",
    slug: "recovery-and-sleep",
    category: "recovery",
    description: "Training breaks your body down — recovery is where you actually get stronger. This pathway covers sleep science, active recovery, rest day strategy, and how to monitor your recovery so you can train smarter.",
    modules: [
      {
        moduleNumber: 1,
        title: "Recovery Is Training",
        description: "Understand why recovery is not passive rest — it's an active process that determines how much of your training you actually keep.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "The Training Adaptation Cycle",
              body: "Every time you train, you apply stress to your body — you break muscle fibers, deplete energy stores, and strain your cardiovascular and nervous systems. This stress is intentional. Your body responds by repairing the damage and rebuilding stronger than before. But this process — called supercompensation — only happens during recovery. If you train again too soon or chronically under-recover, your body never fully adapts, and performance stagnates or declines."
            },
            {
              title: "Overtraining vs. Under-Recovery",
              body: "Most athletes who hit plateaus or get injured aren't training too hard — they're recovering too little. Overtraining syndrome is rare; chronic under-recovery is common. The distinction matters because the solution is different. You can't always train less, but you can almost always recover better — through sleep, nutrition, stress management, and smart scheduling."
            },
            {
              title: "What Recovery Actually Includes",
              body: "Recovery is not just taking a day off. It includes sleep quality and duration, post-workout nutrition, hydration, mental decompression, mobility work, and managing life stress. Every one of these inputs affects how well your body adapts to training. Athletes who treat recovery as an active process see consistently better results than those who simply collapse on the couch and hope for the best."
            },
            {
              title: "Hard Days vs. Easy Days",
              body: "Elite programs are built around alternating hard and easy training days for a reason. Easy days aren't wasted — they're when tissue repairs and the nervous system resets. The mistake most athletes make is making every day a medium-hard day. That's the worst of both worlds: you're not hard enough to drive adaptation, and you're not easy enough to recover. Learn to go truly easy when the program calls for it."
            }
          ]
        },
        keyTakeaways: [
          "Adaptation (getting stronger/faster) happens during recovery — not during training itself.",
          "Chronic under-recovery is more common than overtraining, and both hurt performance.",
          "Recovery includes sleep, nutrition, hydration, stress management, and mobility work.",
          "Easy days are productive — they allow the body to repair and the nervous system to reset."
        ],
        quiz: [
          {
            question: "During which phase does the body actually adapt and get stronger from training?",
            options: [
              "During the workout itself",
              "During the warm-up phase",
              "During recovery after training",
              "During the first set of each exercise"
            ],
            correctAnswer: 2,
            explanation: "Supercompensation — the process of rebuilding stronger than before — happens during the recovery period. Without adequate recovery, adaptation is limited."
          },
          {
            question: "What is the most common reason athletes plateau or get injured?",
            options: [
              "Training too hard for too long",
              "Insufficient recovery relative to training load",
              "Using poor form during heavy lifts",
              "Not taking enough supplements"
            ],
            correctAnswer: 1,
            explanation: "Most plateaus and overuse injuries stem from chronic under-recovery rather than excessive training volume. Athletes often train hard but neglect the recovery inputs needed to adapt."
          },
          {
            question: "Which of the following is NOT a component of proper recovery?",
            options: [
              "Quality sleep",
              "Post-workout nutrition",
              "Training as hard as possible every single day",
              "Hydration and stress management"
            ],
            correctAnswer: 2,
            explanation: "Training maximally every day prevents the recovery needed for adaptation. Quality sleep, nutrition, hydration, and stress management are all active components of recovery."
          },
          {
            question: "Why are easy training days important in a well-designed program?",
            options: [
              "They're built in so athletes can skip without consequence",
              "They allow tissue repair and nervous system reset, making hard days more effective",
              "They burn more fat than hard training days",
              "They're primarily for mental breaks, not physical recovery"
            ],
            correctAnswer: 1,
            explanation: "Easy days allow muscles, connective tissue, and the nervous system to repair and reset, making the body more prepared and adaptive for the next hard training session."
          }
        ]
      },
      {
        moduleNumber: 2,
        title: "The Science of Sleep for Athletes",
        description: "Learn what happens in your body while you sleep, why 8+ hours matters, and how poor sleep destroys athletic performance.",
        estimatedMinutes: 12,
        content: {
          sections: [
            {
              title: "Sleep Is Your #1 Recovery Tool",
              body: "No supplement, massage, or cold plunge comes close to the recovery power of quality sleep. During sleep, your body releases growth hormone, repairs muscle tissue, consolidates motor learning, balances hormones, and clears metabolic waste from the brain. Shortchanging sleep shortchanges every other investment you make in your training."
            },
            {
              title: "Sleep Stages and Why They Matter",
              body: "Sleep cycles through different stages: light sleep, deep sleep (slow-wave sleep), and REM sleep. Deep sleep is when the majority of physical repair and growth hormone release occurs. REM sleep is critical for mental recovery, memory consolidation, and motor skill learning. Athletes who consistently get 7–9 hours of sleep — and maintain consistent sleep/wake times — progress faster and get injured less often than those who don't."
            },
            {
              title: "What Sleep Deprivation Does to Athletes",
              body: "Even one night of poor sleep measurably reduces reaction time, power output, accuracy, decision-making, and motivation to train. Chronic sleep deprivation increases cortisol (a stress hormone), reduces testosterone, impairs immune function, and dramatically increases injury risk. A study on Stanford basketball players found that extending sleep to 10 hours per night improved sprint times, shooting accuracy, and reaction time — with no other changes."
            },
            {
              title: "Building a Sleep Routine That Works",
              body: "Improving sleep doesn't always mean sleeping longer — it starts with consistency. Go to bed and wake up at the same time every day, even on weekends. Reduce screen exposure 60 minutes before bed. Keep your room cool, dark, and quiet. Avoid large meals, caffeine, and intense exercise close to bedtime. If you consistently struggle to fall or stay asleep, speak with a healthcare provider — do not self-medicate."
            }
          ]
        },
        keyTakeaways: [
          "Sleep is the most powerful recovery tool available — prioritize it above all else.",
          "Deep sleep drives physical repair; REM sleep drives mental recovery and motor learning.",
          "Even one night of poor sleep measurably hurts performance, reaction time, and injury risk.",
          "Consistent sleep and wake times matter as much as total hours slept."
        ],
        quiz: [
          {
            question: "Which physical process primarily occurs during deep (slow-wave) sleep?",
            options: [
              "Motor skill memory consolidation",
              "Growth hormone release and muscle tissue repair",
              "Cardiovascular adaptation",
              "Mental decompression and stress relief"
            ],
            correctAnswer: 1,
            explanation: "During deep sleep, the body releases the majority of its daily growth hormone, which is critical for muscle repair and recovery after training."
          },
          {
            question: "What did the Stanford basketball sleep study show?",
            options: [
              "Athletes performed the same regardless of sleep duration",
              "More sleep led to worse reaction times due to grogginess",
              "Extending sleep to 10 hours improved sprint times, shooting accuracy, and reaction time",
              "Athletes only need 6 hours of sleep if training is not intense"
            ],
            correctAnswer: 2,
            explanation: "The Stanford study found that simply extending sleep duration to 10 hours per night — with no other changes — significantly improved multiple athletic performance metrics."
          },
          {
            question: "What effect does chronic sleep deprivation have on cortisol and testosterone?",
            options: [
              "Cortisol decreases; testosterone increases",
              "Both cortisol and testosterone increase",
              "Cortisol increases; testosterone decreases",
              "Neither is affected by sleep patterns"
            ],
            correctAnswer: 2,
            explanation: "Sleep deprivation elevates cortisol (stress hormone) and suppresses testosterone, creating a hormonal environment that promotes muscle breakdown and impairs recovery."
          },
          {
            question: "Which habit is most important for improving sleep quality?",
            options: [
              "Taking melatonin supplements every night",
              "Training as late as possible to ensure physical exhaustion",
              "Maintaining consistent sleep and wake times every day, including weekends",
              "Sleeping in on weekends to 'catch up' on missed sleep"
            ],
            correctAnswer: 2,
            explanation: "Consistent sleep and wake times regulate your circadian rhythm, making it easier to fall asleep, stay asleep, and achieve the deep and REM sleep stages critical for recovery."
          }
        ]
      },
      {
        moduleNumber: 3,
        title: "Active Recovery Methods",
        description: "Discover evidence-based recovery tools — from low-intensity movement to cold exposure — and learn which ones actually work.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "What Is Active Recovery?",
              body: "Active recovery means engaging in low-intensity movement on rest days or between hard sessions. Rather than sitting completely still, light activity — walking, easy cycling, swimming, or mobility work — promotes blood flow to sore muscles, reduces metabolic waste buildup, and maintains movement quality without adding significant stress to the body. Done right, active recovery makes your next hard session feel better."
            },
            {
              title: "Foam Rolling and Mobility Work",
              body: "Foam rolling (self-myofascial release) and targeted stretching can help reduce perceived soreness and improve range of motion between sessions. The research on foam rolling is mixed — it likely works more by reducing perceived pain and improving tissue pliability than by physically restructuring muscles. Regardless, athletes who spend 10–15 minutes on mobility work between sessions tend to feel better and move better going into their next training day."
            },
            {
              title: "Cold and Heat Exposure",
              body: "Cold water immersion (ice baths) can reduce acute muscle soreness and inflammation after intense training. However, research suggests frequent use of cold immediately after strength training may blunt long-term muscle growth adaptations by suppressing the inflammatory response that drives adaptation. Use cold strategically — for recovery during congested competition schedules, not after every strength session. Heat (saunas, hot baths) can improve blood flow, reduce muscle tension, and support cardiovascular health — but stay well hydrated."
            },
            {
              title: "What Doesn't Work as Well as Marketed",
              body: "The recovery industry is full of products and gadgets with weak evidence behind them. Many compression devices, electrical stimulation tools, and exotic supplements have limited scientific backing for performance recovery. The basics — sleep, nutrition, hydration, and movement — deliver the greatest recovery benefit. Don't spend money on expensive recovery gimmicks while neglecting the fundamentals."
            }
          ]
        },
        keyTakeaways: [
          "Active recovery (light movement, mobility work) promotes blood flow and reduces soreness without adding training stress.",
          "Foam rolling may reduce perceived soreness and improve range of motion between sessions.",
          "Cold exposure can help during congested schedules but may reduce long-term strength adaptations if overused.",
          "Sleep, nutrition, and hydration outperform almost every recovery gadget or product."
        ],
        quiz: [
          {
            question: "What is the primary benefit of active recovery compared to complete rest?",
            options: [
              "It burns more calories than rest",
              "It eliminates all soreness within 24 hours",
              "It promotes blood flow, removes metabolic waste, and maintains movement quality",
              "It builds strength faster than a regular training session"
            ],
            correctAnswer: 2,
            explanation: "Low-intensity active recovery increases blood flow to sore muscles, helps clear metabolic waste, and maintains mobility without creating significant additional training stress."
          },
          {
            question: "Why should athletes be cautious about using cold immersion frequently after strength training?",
            options: [
              "Cold causes muscle cramps and should always be avoided",
              "Cold reduces blood flow so dramatically that it causes injury",
              "Frequent cold use may blunt long-term muscle growth by suppressing the inflammatory response needed for adaptation",
              "Cold is only effective for endurance athletes, not strength athletes"
            ],
            correctAnswer: 2,
            explanation: "Research suggests that using cold immersion too frequently after strength training may suppress the inflammation that drives muscle adaptation, potentially limiting long-term gains."
          },
          {
            question: "Which recovery method has the strongest evidence base and greatest impact on athletic performance?",
            options: [
              "Electrical muscle stimulation devices",
              "Expensive compression recovery systems",
              "Sleep, nutrition, and hydration",
              "Daily ice baths lasting 30+ minutes"
            ],
            correctAnswer: 2,
            explanation: "The evidence overwhelmingly supports sleep, nutrition, and hydration as the most impactful recovery strategies. Expensive gadgets rarely match these fundamentals in effectiveness."
          }
        ]
      },
      {
        moduleNumber: 4,
        title: "Monitoring Your Recovery",
        description: "Learn how to track daily readiness so you can train smarter, adjust intensity, and reduce injury risk.",
        estimatedMinutes: 8,
        content: {
          sections: [
            {
              title: "Why Monitoring Matters",
              body: "Athletes who pay attention to how they feel — and adjust training accordingly — train more consistently over the long run and stay injury-free longer. The goal is not to avoid hard training; it's to ensure hard training happens on days when your body can actually absorb and adapt to the stress."
            },
            {
              title: "Simple Recovery Metrics You Can Track",
              body: "You don't need a $400 wearable to monitor recovery. Simple subjective measures are highly effective: Rate your sleep quality (1–10), your mood and motivation (1–10), your muscle soreness level (1–10), and your perceived energy level (1–10) each morning. Averaging these gives a useful daily readiness score. Tracking this over time helps you identify patterns — what tanks your recovery, and what helps it."
            },
            {
              title: "Resting Heart Rate as a Recovery Indicator",
              body: "Resting heart rate (RHR) is one of the most reliable physiological markers of recovery status. When you're well-recovered, your RHR tends to be at or below your baseline. When it's elevated 5–7+ beats above your baseline, your nervous system may still be under stress from previous training. Measure RHR in the morning before getting out of bed for the most accurate reading."
            },
            {
              title: "When to Adjust Your Training",
              body: "If your readiness scores are consistently low for 3+ days in a row, something needs to change — more sleep, better nutrition, reduced training intensity, or a hard look at life stress. A single bad day doesn't require a program overhaul. A persistent pattern does. Communicate with your coach when you're consistently feeling depleted — they can adjust your program before it becomes an injury."
            }
          ]
        },
        keyTakeaways: [
          "Monitoring recovery helps you train on days you can absorb stress and adapt on days you can't.",
          "Simple daily ratings (sleep, mood, soreness, energy) provide useful recovery data.",
          "Elevated resting heart rate is a reliable signal that the nervous system is still recovering.",
          "A consistent pattern of low readiness scores is a signal to adjust training or recovery habits."
        ],
        quiz: [
          {
            question: "Which of the following is the most accurate time to measure resting heart rate for recovery monitoring?",
            options: [
              "Immediately after a training session",
              "In the evening before bed",
              "In the morning before getting out of bed",
              "During a light warm-up activity"
            ],
            correctAnswer: 2,
            explanation: "Resting heart rate is most stable and accurate when measured in the morning before physical activity, as any movement or stress can artificially elevate it."
          },
          {
            question: "What does a consistently elevated resting heart rate (5–7+ beats above baseline) typically indicate?",
            options: [
              "Improved cardiovascular fitness",
              "The nervous system is still under recovery stress from previous training",
              "Dehydration from the previous evening",
              "A signal to increase training intensity immediately"
            ],
            correctAnswer: 1,
            explanation: "An elevated RHR above personal baseline often indicates the nervous system has not fully recovered from previous training stress, suggesting a need for easier training or additional recovery."
          },
          {
            question: "What should an athlete do if readiness scores are consistently low for 3+ consecutive days?",
            options: [
              "Push through — the body needs to adapt to discomfort",
              "Immediately stop all training for two weeks",
              "Assess sleep, nutrition, stress, and training load — and communicate with the coach",
              "Add a recovery supplement to compensate"
            ],
            correctAnswer: 2,
            explanation: "A persistent pattern of low readiness scores is a signal to investigate contributing factors — sleep, nutrition, training volume, and life stress — and adjust before it leads to injury or illness."
          }
        ]
      }
    ]
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 3. HYDRATION FOR PERFORMANCE
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "default-pathway-hydration",
    title: "Hydration for Performance",
    slug: "hydration-for-performance",
    category: "hydration",
    description: "Most athletes underestimate how dramatically hydration affects performance. Learn the science of fluid balance, electrolytes, sweat loss, and how to stay optimally hydrated before, during, and after training.",
    modules: [
      {
        moduleNumber: 1,
        title: "Water and Athletic Performance",
        description: "Understand why water is the most important performance nutrient and what dehydration actually does to your body.",
        estimatedMinutes: 8,
        content: {
          sections: [
            {
              title: "Your Body Is Mostly Water",
              body: "Water makes up about 60% of total body weight and is involved in nearly every physiological process — energy production, temperature regulation, nutrient transport, joint lubrication, and waste removal. During exercise, your body generates heat; sweating is how you cool down. If you don't replace lost fluids, your body's ability to regulate temperature and deliver oxygen to muscles degrades quickly."
            },
            {
              title: "How Dehydration Hurts Performance",
              body: "Research consistently shows that losing just 2% of body weight in fluids can reduce aerobic performance by 10–20%. At 3–4% dehydration, strength output, reaction time, and cognitive function are significantly impaired. Athletes often don't feel thirsty until they're already 1–2% dehydrated — meaning thirst is a lagging indicator, not an early warning system."
            },
            {
              title: "Urine Color: Your Daily Hydration Check",
              body: "The easiest way to monitor hydration status daily is urine color. Pale yellow (like lemonade) indicates good hydration. Dark yellow or amber indicates you need to drink more. Colorless urine can indicate overhydration — drinking too much water too quickly, which dilutes electrolytes. Check urine color first thing in the morning and throughout the day as a simple, free hydration tool."
            },
            {
              title: "How Much Water Do Athletes Need?",
              body: "General fluid guidelines for athletes: 16–20 oz of water in the 2–3 hours before training, 6–8 oz every 15–20 minutes during training, and 16–24 oz for every pound of bodyweight lost after training. These are starting points — individual sweat rates vary significantly. Athletes who train in hot, humid conditions or who sweat heavily will need more."
            }
          ]
        },
        keyTakeaways: [
          "Losing just 2% of bodyweight in fluid can reduce aerobic performance by 10–20%.",
          "Thirst is a lagging indicator — don't wait until you're thirsty to drink.",
          "Urine color (pale yellow = good; dark = drink more) is an easy daily hydration check.",
          "Athletes need fluid before, during, and after training — not just when they feel thirsty."
        ],
        quiz: [
          {
            question: "At what percentage of body weight lost in fluids does aerobic performance begin to meaningfully decline?",
            options: ["0.5%", "2%", "5%", "8%"],
            correctAnswer: 1,
            explanation: "Research shows that just 2% dehydration can reduce aerobic performance by 10–20%. This can happen within 30–45 minutes of training without adequate hydration."
          },
          {
            question: "What does dark yellow or amber urine typically indicate?",
            options: [
              "Normal hydration for an athlete",
              "Overhydration — too much water consumed",
              "Dehydration — more fluids need to be consumed",
              "Adequate electrolyte balance"
            ],
            correctAnswer: 2,
            explanation: "Dark urine indicates the kidneys are concentrating waste products due to insufficient fluid intake — a sign of dehydration that should be addressed."
          },
          {
            question: "Why is thirst an unreliable early warning sign of dehydration for athletes?",
            options: [
              "Athletes have higher thirst tolerance due to adaptation",
              "Thirst receptors become desensitized during intense exercise",
              "Athletes don't feel thirsty until they're already 1–2% dehydrated",
              "Thirst only occurs during very hot conditions"
            ],
            correctAnswer: 2,
            explanation: "The sensation of thirst typically lags behind actual fluid loss by 1–2% of bodyweight, meaning athletes may already be in a performance-impairing hydration deficit before feeling thirsty."
          },
          {
            question: "Approximately how much water should athletes consume every 15–20 minutes during training?",
            options: ["2–4 oz", "6–8 oz", "12–16 oz", "24–32 oz"],
            correctAnswer: 1,
            explanation: "6–8 oz every 15–20 minutes during exercise is a general guideline to replace sweat losses and maintain performance — though exact needs vary by sweat rate and conditions."
          }
        ]
      },
      {
        moduleNumber: 2,
        title: "Electrolytes and Sweat Loss",
        description: "Learn what electrolytes are, why you lose them in sweat, and how to replace them to prevent cramping and maintain performance.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "What Are Electrolytes?",
              body: "Electrolytes are minerals that carry an electrical charge and are essential for muscle contractions, nerve signaling, fluid balance, and heart rhythm. The primary electrolytes lost in sweat are sodium, potassium, magnesium, chloride, and calcium. Sodium is lost in the greatest amounts and is the most critical to replace during and after prolonged exercise."
            },
            {
              title: "Sweat Rate Varies by Individual",
              body: "Some athletes are 'salty sweaters' — they lose significantly more sodium per liter of sweat than others. This varies by genetics, fitness level, heat acclimatization, and individual physiology. If you regularly notice white residue on your skin or clothing after training, or frequently experience cramping, you may be a high-sodium sweater and need to be more deliberate about electrolyte replacement."
            },
            {
              title: "When Plain Water Isn't Enough",
              body: "For workouts under 60 minutes at moderate intensity, water alone is typically sufficient. For sessions lasting 60+ minutes — or any session in hot, humid conditions — electrolyte replacement becomes important. Drinking large amounts of plain water without replacing sodium can actually dilute blood sodium levels, a condition called hyponatremia, which causes nausea, headache, confusion, and in severe cases, can be life-threatening."
            },
            {
              title: "Smart Electrolyte Replacement Strategies",
              body: "Sports drinks, electrolyte tablets, and electrolyte-fortified beverages can all serve as effective replacement tools during prolonged exercise. Food sources like bananas (potassium), salted crackers (sodium), and dairy (calcium and potassium) support electrolyte recovery after training. Read labels on sports drinks — many contain high amounts of sugar, which may not be necessary for shorter sessions."
            }
          ]
        },
        keyTakeaways: [
          "Electrolytes (especially sodium) are lost in sweat and must be replaced during long or hot sessions.",
          "Individual sweat rates vary — salty sweaters and high-volume sweaters need more electrolytes.",
          "Plain water is sufficient for sessions under 60 minutes; longer sessions require electrolytes.",
          "Overdrinking plain water without electrolytes can dangerously dilute blood sodium (hyponatremia)."
        ],
        quiz: [
          {
            question: "Which electrolyte is lost in the greatest amounts through sweat and is most critical to replace?",
            options: ["Potassium", "Magnesium", "Sodium", "Calcium"],
            correctAnswer: 2,
            explanation: "Sodium is the primary electrolyte in sweat and the most critical to replace during prolonged exercise. Depletion contributes to cramping, fatigue, and impaired fluid balance."
          },
          {
            question: "What is hyponatremia and how does it occur in athletes?",
            options: [
              "Excessive sodium intake causing high blood pressure",
              "A dangerous drop in blood sodium from overdrinking plain water without electrolytes",
              "Cramping caused by low potassium levels",
              "Dehydration caused by sweating too much in the heat"
            ],
            correctAnswer: 1,
            explanation: "Hyponatremia occurs when athletes drink excessive amounts of plain water, diluting blood sodium to dangerously low levels. It causes nausea, confusion, and can be life-threatening."
          },
          {
            question: "When does electrolyte replacement become important beyond water alone?",
            options: [
              "For every workout regardless of duration",
              "Only during outdoor summer competitions",
              "For sessions lasting 60+ minutes or any session in hot, humid conditions",
              "Only for endurance athletes running 10+ miles"
            ],
            correctAnswer: 2,
            explanation: "For sessions under 60 minutes at moderate intensity, water is typically adequate. Beyond 60 minutes or in the heat, electrolyte replacement becomes essential for maintaining performance and safety."
          }
        ]
      },
      {
        moduleNumber: 3,
        title: "Hydration Before, During, and After",
        description: "Build a practical hydration plan for every phase of training and competition.",
        estimatedMinutes: 8,
        content: {
          sections: [
            {
              title: "Pre-Training Hydration",
              body: "Start every training session already hydrated — not trying to catch up. Drink 16–20 oz of water 2–3 hours before training and another 8 oz about 15–20 minutes before starting. If your urine is pale yellow in the morning, you're starting the day in a good spot. If it's dark, drink more water before training begins. Don't gulp large amounts immediately before exercise — it can cause sloshing and discomfort."
            },
            {
              title: "Hydration During Training",
              body: "Sip consistently during training rather than waiting until you're thirsty. 6–8 oz every 15–20 minutes is a practical target for most training environments. For sessions over an hour — or sessions in hot conditions — choose a sports drink or add electrolytes to water. Have a water bottle accessible at all times during training; athletes who have to leave to find water consistently drink less."
            },
            {
              title: "Post-Training Rehydration",
              body: "After training, the goal is to restore fluid and electrolyte balance. Drink 16–24 oz of fluid for every pound of bodyweight lost during training. You can track sweat loss by weighing yourself (in minimal clothing) before and after training. For most athletes and training environments, this means drinking 16–32 oz of water or a sports drink within the first 30–60 minutes after training, then continuing to drink throughout the rest of the day."
            },
            {
              title: "Hydration and Sleep",
              body: "Many athletes wake up dehydrated — especially those who train hard the day before and don't rehydrate fully. Going to bed even mildly dehydrated can reduce sleep quality and leave you starting the next day already in a deficit. Make drinking water in the hour before bed (not so much it disrupts sleep) part of your recovery routine."
            }
          ]
        },
        keyTakeaways: [
          "Start every session already hydrated — drink 16–20 oz 2–3 hours before training.",
          "Sip 6–8 oz every 15–20 minutes during training; use electrolytes for sessions over 60 minutes.",
          "Replenish 16–24 oz for every pound of bodyweight lost after training.",
          "Mild dehydration at bedtime reduces sleep quality and starts the next day with a deficit."
        ],
        quiz: [
          {
            question: "How much water should athletes drink 2–3 hours before training?",
            options: ["4–6 oz", "8–12 oz", "16–20 oz", "32–40 oz"],
            correctAnswer: 2,
            explanation: "Drinking 16–20 oz 2–3 hours before training gives the body time to absorb and distribute fluid before exercise begins, supporting pre-exercise hydration status."
          },
          {
            question: "What is the recommended post-workout fluid replacement guideline?",
            options: [
              "Drink 8 oz immediately after training, then stop",
              "Drink 16–24 oz for every pound of bodyweight lost during training",
              "Drink 1 liter per hour of training completed",
              "Drink only when thirsty after training"
            ],
            correctAnswer: 1,
            explanation: "Replacing 16–24 oz of fluid per pound of bodyweight lost helps restore hydration status and supports recovery. Weighing before and after training tracks actual sweat loss."
          },
          {
            question: "Why does going to bed mildly dehydrated negatively affect the next training session?",
            options: [
              "Dehydration causes insomnia, preventing sleep entirely",
              "The body cannot produce growth hormone without adequate hydration",
              "Mild dehydration impairs sleep quality and starts the next day already in a fluid deficit",
              "Dehydration reduces body temperature during sleep"
            ],
            correctAnswer: 2,
            explanation: "Even mild overnight dehydration reduces sleep quality and means athletes begin the next day already behind on fluid balance — compounding performance impairment if not corrected before training."
          }
        ]
      }
    ]
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 4. TRAINING HABITS
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "default-pathway-training-habits",
    title: "Training Habits",
    slug: "training-habits",
    category: "custom",
    description: "Success in strength and conditioning is built on daily habits — not occasional heroic efforts. This pathway covers the mindset, habits, and fundamentals that separate athletes who consistently improve from those who plateau.",
    modules: [
      {
        moduleNumber: 1,
        title: "Building an Athletic Mindset",
        description: "Understand the mental frameworks that drive consistent improvement — and the habits that hold athletes back.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "Process vs. Outcome Thinking",
              body: "Athletes who focus purely on outcomes — winning, hitting a specific number, making a team — often struggle with motivation when results don't come immediately. Athletes who focus on the process — showing up consistently, executing correctly, recovering well — build habits that produce results over time. The mindset shift from 'I want to be fast' to 'I'm going to do the things that make athletes faster' changes everything."
            },
            {
              title: "Identity-Based Habits",
              body: "The most durable habit changes come from identity shifts, not willpower. Instead of saying 'I'm trying to eat better,' an athlete who says 'I'm someone who fuels for performance' is more likely to make consistent choices. Every time you show up to training, execute the program, prioritize sleep, and fuel intentionally — you're voting for the type of athlete you're becoming. These votes accumulate."
            },
            {
              title: "Managing the All-or-Nothing Trap",
              body: "One of the most common training pitfalls is the all-or-nothing mentality: 'I missed one workout, so the week is ruined.' This thinking causes athletes to abandon entire weeks of consistency over a single missed session. The reality: one missed session has essentially zero impact on long-term progress. Getting back on track the next day matters infinitely more than the session you missed."
            },
            {
              title: "Coachability Is a Competitive Advantage",
              body: "Athletes who are easy to coach — who listen, ask good questions, take feedback without defensiveness, and implement what they learn — consistently outperform athletes of equal or greater physical talent who resist coaching. Being coachable is a skill you can deliberately develop. Ask your coach what you should be working on. Act on the feedback. Come back and report. That loop accelerates development faster than any program."
            }
          ]
        },
        keyTakeaways: [
          "Focus on the process (daily habits) over outcomes — results follow consistent behavior.",
          "Identity-based habits ('I am an athlete who…') are more durable than willpower-based changes.",
          "Missing one session is irrelevant — getting back on track immediately is everything.",
          "Coachability is a trainable skill and a competitive advantage."
        ],
        quiz: [
          {
            question: "What is the key difference between process thinking and outcome thinking in training?",
            options: [
              "Process thinkers train harder every session; outcome thinkers train smarter",
              "Process thinkers focus on daily habits and behaviors; outcome thinkers focus only on results",
              "Outcome thinking is more effective for advanced athletes",
              "Process thinking only applies to endurance athletes"
            ],
            correctAnswer: 1,
            explanation: "Process thinkers focus on the daily behaviors — showing up, executing correctly, recovering well — that drive long-term results, rather than fixating on outcomes that take time to materialize."
          },
          {
            question: "What is the 'all-or-nothing trap' in training?",
            options: [
              "Training too intensely without scheduled rest days",
              "Abandoning consistency after one missed session or imperfect day",
              "Refusing to try any new exercises outside of the program",
              "Only training when motivation is at its highest"
            ],
            correctAnswer: 1,
            explanation: "The all-or-nothing trap causes athletes to throw away entire weeks of good habits because of one missed session. In reality, one missed day has negligible impact — getting back on track immediately is what matters."
          },
          {
            question: "Why is coachability considered a competitive advantage?",
            options: [
              "Coaches prefer working with coachable athletes and give them extra resources",
              "Coachable athletes listen, implement feedback, and accelerate development faster than resistant athletes",
              "Coachability reduces the amount of training required to see results",
              "Coaches design easier programs for athletes who listen well"
            ],
            correctAnswer: 1,
            explanation: "Athletes who actively listen, act on feedback, and report back create a coaching loop that dramatically accelerates skill and performance development — often outpacing more physically gifted but resistant athletes."
          }
        ]
      },
      {
        moduleNumber: 2,
        title: "The Warm-Up Is Not Optional",
        description: "Understand why the warm-up is one of the most important parts of every training session — not something to skip when you're running late.",
        estimatedMinutes: 8,
        content: {
          sections: [
            {
              title: "What a Warm-Up Actually Does",
              body: "A proper warm-up does far more than just 'get loose.' It raises core body temperature, which increases muscle elasticity and enzymatic activity that powers energy production. It increases heart rate and blood flow to working muscles, preparing the cardiovascular system for the upcoming demand. It activates the neuromuscular pathways — essentially 'turning on' the motor patterns you'll use in training. And it mentally transitions you from whatever you were doing before into the session ahead."
            },
            {
              title: "Injury Prevention Starts in the Warm-Up",
              body: "Cold muscles, tendons, and ligaments are significantly more susceptible to strains, tears, and pulls than warm, primed tissue. Most soft-tissue injuries in training happen early in sessions when tissue isn't properly prepared, or when athletes skip the warm-up entirely due to time pressure or laziness. The 10–15 minutes spent warming up protects the 60–90 minutes of actual training that follows."
            },
            {
              title: "Dynamic vs. Static Stretching",
              body: "Modern warm-ups should prioritize dynamic (moving) stretches — leg swings, arm circles, hip rotations, bodyweight squats, lunges, inchworms — over static (held) stretches. Research shows that extended static stretching before training can temporarily reduce peak force production by inhibiting the stretch-shortening cycle in muscles. Save static stretching for after training or separate mobility sessions."
            },
            {
              title: "A Framework for an Effective Warm-Up",
              body: "A simple warm-up framework: (1) 3–5 minutes of low-intensity cardio to raise heart rate and body temperature, (2) 5–7 minutes of dynamic mobility targeting the joints and muscles most involved in today's training, (3) 2–3 minutes of movement preparation — activation exercises for key muscle groups like glutes, lats, or rotator cuffs depending on the session. Then build weight or intensity gradually in the early working sets."
            }
          ]
        },
        keyTakeaways: [
          "A warm-up raises temperature, activates motor patterns, and primes the cardiovascular system.",
          "Most soft-tissue injuries happen when athletes skip warm-ups or start too cold.",
          "Dynamic stretching is preferred before training; static stretching is better saved for after.",
          "A good warm-up takes 10–15 minutes and directly protects your training session."
        ],
        quiz: [
          {
            question: "What type of stretching is recommended BEFORE a training session?",
            options: [
              "Static stretching (holding each stretch for 30–60 seconds)",
              "Dynamic stretching (leg swings, hip rotations, inchworms)",
              "Passive stretching with a partner",
              "No stretching — just begin lifting immediately"
            ],
            correctAnswer: 1,
            explanation: "Dynamic stretching actively moves joints through their range of motion, which is more effective for warm-up preparation. Static stretching before training can temporarily reduce force production."
          },
          {
            question: "When do most soft-tissue injuries occur during training sessions?",
            options: [
              "During the final sets when muscles are fatigued",
              "During the cooldown phase",
              "Early in sessions when tissue hasn't been properly warmed up",
              "Injuries are evenly distributed throughout sessions"
            ],
            correctAnswer: 2,
            explanation: "Cold muscles, tendons, and ligaments are more susceptible to injury. Most soft-tissue injuries occur early in sessions or when athletes skip warm-ups and begin with heavy or explosive movements."
          },
          {
            question: "Which statement about warm-ups is accurate?",
            options: [
              "The warm-up only matters for endurance athletes",
              "A warm-up is optional if the athlete is already physically fit",
              "A warm-up raises temperature, activates neuromuscular pathways, and reduces injury risk",
              "Warm-ups should last at least 45 minutes to be effective"
            ],
            correctAnswer: 2,
            explanation: "A proper warm-up prepares the body physically (temperature, blood flow) and neurologically (motor pattern activation), directly reducing injury risk and improving training performance."
          }
        ]
      },
      {
        moduleNumber: 3,
        title: "Progressive Overload Basics",
        description: "Learn the most important principle in strength training — and how to apply it intelligently over time.",
        estimatedMinutes: 12,
        content: {
          sections: [
            {
              title: "What Is Progressive Overload?",
              body: "Progressive overload is the foundational principle of all strength and conditioning: to keep getting stronger, faster, or more conditioned, the training stimulus must gradually increase over time. Your body adapts to whatever stress you consistently apply. Once it adapts, that stress no longer drives further change — you must increase the challenge to continue progressing. This can be done by adding weight, increasing reps, adding sets, reducing rest time, or improving technique."
            },
            {
              title: "Why Most Athletes Plateau",
              body: "Most long-term training plateaus have one cause: the athlete has been doing the same thing for too long without progression. The body adapted months ago, and now training is just maintenance — not improvement. Avoiding this requires deliberate, systematic progression that is tracked and adjusted. You can't improve what you don't measure, and you can't progress without a plan."
            },
            {
              title: "How to Progress Without Getting Hurt",
              body: "The primary risk of progressive overload is progressing too aggressively, which leads to technique breakdown and injury. A common and safe guideline is the 10% rule: increase total training load (weight × reps × sets) by no more than 10% per week. This allows tissue to adapt at a pace the body can handle. Listen to your coach's programming — they're accounting for your individual readiness."
            },
            {
              title: "Tracking Your Progress",
              body: "You must track your training to progressively overload intelligently. Keep a training log — even a simple notes app on your phone works. Record weights, sets, and reps. Review it before each session to know what you need to beat. Athletes who track their training consistently outperform those who train by feel alone, because they can identify what's working, what's stalling, and when to push versus when to back off."
            }
          ]
        },
        keyTakeaways: [
          "Progressive overload is the core principle behind all strength and conditioning gains.",
          "Plateaus usually mean the training stimulus hasn't changed — progression has stalled.",
          "Increase load gradually (roughly 10% per week) to adapt without risking injury.",
          "Track your training — you can't progressively overload what you haven't measured."
        ],
        quiz: [
          {
            question: "What is progressive overload?",
            options: [
              "Training as hard as possible every single session regardless of readiness",
              "Gradually increasing the training stimulus over time so the body continues to adapt",
              "Changing exercises every session to prevent boredom",
              "Adding maximum weight as quickly as possible to build strength"
            ],
            correctAnswer: 1,
            explanation: "Progressive overload means systematically increasing the training stimulus — through weight, reps, sets, or density — so the body continues to be challenged beyond its current adaptation level."
          },
          {
            question: "What is the most common cause of long-term training plateaus?",
            options: [
              "Eating too much protein",
              "Training too many different muscle groups",
              "Doing the same training without progression for too long",
              "Not using enough variety in exercise selection"
            ],
            correctAnswer: 2,
            explanation: "Once the body adapts to a training stimulus, it stops driving further change. Athletes who do the same thing without systematic progression enter maintenance mode and stop improving."
          },
          {
            question: "What is the 10% rule in progressive overload?",
            options: [
              "Add 10 lbs to every lift each week",
              "Increase total training load by no more than 10% per week to allow safe adaptation",
              "Train 10% harder than your maximum every session",
              "Rest for 10% of your total training time each day"
            ],
            correctAnswer: 1,
            explanation: "The 10% guideline suggests increasing total training load (weight × reps × sets) by no more than 10% per week to allow tissues to adapt without exceeding their recovery capacity."
          },
          {
            question: "Why is tracking training data important for progressive overload?",
            options: [
              "It allows athletes to compete with their teammates",
              "It helps coaches assign athletes to specific programs",
              "It enables athletes to know exactly what to beat in the next session and identify stalling",
              "It is required for college recruiting profiles"
            ],
            correctAnswer: 2,
            explanation: "Without tracking, athletes can't know whether they're truly progressing, identify when a plateau has started, or make informed decisions about when to push versus when to back off."
          }
        ]
      }
    ]
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 5. READINESS & SORENESS
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "default-pathway-readiness",
    title: "Readiness & Soreness",
    slug: "readiness-and-soreness",
    category: "custom",
    description: "Learn the difference between productive soreness and warning signs your body sends. This pathway covers how to read your body, manage fatigue, and train intelligently across a full season.",
    modules: [
      {
        moduleNumber: 1,
        title: "Soreness vs. Pain: Know the Difference",
        description: "Understand the critical distinction between normal training soreness and pain that signals potential injury.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "DOMS: Delayed Onset Muscle Soreness",
              body: "Delayed onset muscle soreness (DOMS) typically begins 12–24 hours after a training session and peaks around 24–72 hours post-training. It's caused by microscopic damage to muscle fibers — particularly from eccentric (lengthening under load) exercise. DOMS is normal, temporary, and a sign that your muscles experienced a novel or intense stimulus. It is not a measure of how good a workout was, and training should not be judged by how sore it makes you."
            },
            {
              title: "What Normal Soreness Feels Like",
              body: "Normal training soreness is diffuse — spread across a muscle group rather than concentrated in a specific point. It tends to feel like a dull ache or tightness that worsens when the muscle is first engaged but often decreases after a proper warm-up. It affects both sides of the body equally if the training was bilateral, and it resolves within 3–5 days without treatment."
            },
            {
              title: "Pain That Should Stop You",
              body: "Pain that is sharp, localized to a specific point, or worsens during activity is different from soreness and warrants attention. Joint pain (knees, shoulders, hips, ankles) during movement is not normal and should not be trained through. Pain that persists more than 5–7 days after training, or that changes in character (from dull to sharp), requires evaluation by a qualified healthcare professional. When in doubt, speak up — do not self-diagnose or push through significant pain. This module provides general education, not medical advice."
            },
            {
              title: "Communicating With Your Coach",
              body: "Coaches can only help you if they know what's happening. If something hurts — really hurts — tell your coach before the session starts, not after you've aggravated it through an entire workout. Coaches modify exercises, adjust load, and shift training emphasis all the time for athletes who communicate. Athletes who hide pain to avoid looking weak end up with more serious injuries than athletes who speak up."
            }
          ]
        },
        keyTakeaways: [
          "DOMS is normal, temporary, and caused by microscopic muscle damage — not injury.",
          "Normal soreness is diffuse, bilateral, dull, and resolves within 3–5 days.",
          "Sharp, localized, or worsening pain during activity is different from soreness and needs evaluation.",
          "Communicate pain to your coach early — do not train through significant pain."
        ],
        quiz: [
          {
            question: "When does DOMS (delayed onset muscle soreness) typically peak after training?",
            options: [
              "Immediately after the workout",
              "12–24 hours after training",
              "24–72 hours after training",
              "5–7 days after training"
            ],
            correctAnswer: 2,
            explanation: "DOMS typically peaks 24–72 hours after a training session, which is why you often feel sorerer the day after the day after a hard session than the day immediately following it."
          },
          {
            question: "Which of the following describes pain that should cause an athlete to STOP training and seek evaluation?",
            options: [
              "Diffuse muscle ache that started 24 hours after the last workout",
              "Mild tightness in the legs that improves after warming up",
              "Sharp, localized pain in a joint that worsens during movement",
              "General fatigue and heaviness in the muscles"
            ],
            correctAnswer: 2,
            explanation: "Sharp, localized pain in a joint that worsens during activity is a warning sign of potential injury. This is distinct from diffuse, dull muscle soreness and should not be trained through."
          },
          {
            question: "What is a key characteristic that distinguishes normal training soreness from a potential injury signal?",
            options: [
              "Normal soreness only occurs in the upper body",
              "Normal soreness is localized to a single point and gets sharper during movement",
              "Normal soreness is diffuse across a muscle group and typically resolves within 3–5 days",
              "Normal soreness is always completely gone within 24 hours"
            ],
            correctAnswer: 2,
            explanation: "Normal DOMS is diffuse (spread across a muscle group), bilateral when training was bilateral, and resolves within 3–5 days. Localized, sharp, or worsening discomfort warrants evaluation."
          }
        ]
      },
      {
        moduleNumber: 2,
        title: "Managing Fatigue Through a Season",
        description: "Understand how fatigue accumulates across a training season and what you can do to manage it intelligently.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "Acute vs. Chronic Fatigue",
              body: "Acute fatigue is the normal tiredness you feel after a hard training session or game — it resolves with rest and nutrition. Chronic fatigue accumulates over weeks when training load consistently exceeds recovery capacity. Chronic fatigue is characterized by declining performance despite consistent training, persistent muscle heaviness, elevated resting heart rate, poor sleep, mood changes, and reduced motivation to train. It's a warning signal, not a character flaw."
            },
            {
              title: "The Concept of Functional Overreaching",
              body: "Elite programs often include intentional periods of increased training load — called functional overreaching — followed by a planned recovery or 'deload' period. During the overreach, performance may temporarily decline. After the deload, performance typically rebounds higher than before. This is a planned, periodized approach. Unplanned overreaching without recovery leads to overtraining syndrome — which can take months to recover from."
            },
            {
              title: "Deload Weeks: Not a Weakness",
              body: "A deload week typically involves reducing training volume and/or intensity by 30–50% while maintaining movement quality and practice. Its purpose is to allow accumulated fatigue to dissipate and let the adaptations built during harder training express themselves. Athletes who resist deloads often sacrifice long-term development for short-term effort metrics. Trust the process — deloads make the next training block more effective."
            },
            {
              title: "In-Season vs. Off-Season Demands",
              body: "Managing training load looks different in-season versus off-season. In-season, the priority is maintaining strength and conditioning built in the off-season while managing the added stress of competition and practice. This usually means lower training volume with maintained intensity. Off-season is where most development happens — more training volume, harder sessions, and the time to build physical qualities that transfer to performance."
            }
          ]
        },
        keyTakeaways: [
          "Acute fatigue resolves with rest; chronic fatigue builds up when recovery consistently lags training.",
          "Planned overreaching followed by a deload is an effective periodization strategy.",
          "Deload weeks reduce accumulated fatigue and allow training adaptations to express themselves.",
          "In-season training focuses on maintaining off-season gains; off-season is where most development occurs."
        ],
        quiz: [
          {
            question: "What distinguishes chronic fatigue from normal (acute) training fatigue?",
            options: [
              "Chronic fatigue occurs only in professional athletes",
              "Chronic fatigue is present only during the competitive season",
              "Chronic fatigue accumulates over weeks and is associated with declining performance, poor sleep, and low motivation",
              "Chronic fatigue is resolved after a single rest day"
            ],
            correctAnswer: 2,
            explanation: "Chronic fatigue builds over weeks when training exceeds recovery. It manifests as consistently declining performance, elevated resting heart rate, poor sleep, mood changes, and reduced motivation — unlike acute fatigue which resolves within 1–2 days."
          },
          {
            question: "What is a 'deload week' designed to accomplish?",
            options: [
              "Completely stop all physical activity for one week",
              "Allow accumulated fatigue to dissipate and let training adaptations express themselves",
              "Build more training volume than a regular week to accelerate progress",
              "Test an athlete's maximum strength levels"
            ],
            correctAnswer: 1,
            explanation: "A deload week (reduced volume/intensity) clears accumulated fatigue without losing fitness, allowing the adaptations built during harder training to manifest as improved performance afterward."
          },
          {
            question: "What is the primary training focus during the competitive (in-season) period?",
            options: [
              "Building maximum strength through progressive overload programs",
              "Maintaining off-season conditioning gains while managing competition stress",
              "Reducing all training to prevent injury during games",
              "Shifting entirely to aerobic conditioning work"
            ],
            correctAnswer: 1,
            explanation: "In-season training typically reduces volume while maintaining intensity, focusing on preserving the strength and conditioning built during off-season while managing the added stress of competition and practice."
          }
        ]
      }
    ]
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 6. MINDSET & TEAM STANDARDS
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "default-pathway-mindset",
    title: "Mindset & Team Standards",
    slug: "mindset-and-team-standards",
    category: "mindset",
    description: "The mental side of athletic performance is often the difference between good and great. This pathway covers winning mindsets, team culture, goal setting, handling adversity, and what it means to hold yourself and your teammates to a high standard.",
    modules: [
      {
        moduleNumber: 1,
        title: "The Winning Mindset",
        description: "Explore the mental frameworks and daily habits that separate high-performing athletes from those with equal physical talent.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "Fixed vs. Growth Mindset",
              body: "Psychologist Carol Dweck's research identified two fundamental mindsets: fixed (believing abilities are set and unchangeable) and growth (believing abilities can be developed through effort and learning). Athletes with a fixed mindset avoid challenges for fear of exposing limitations. Athletes with a growth mindset seek challenges because they represent opportunities to improve. In the weight room and on the field, the growth mindset consistently wins over time."
            },
            {
              title: "Mental Toughness Is a Skill, Not a Trait",
              body: "Mental toughness is often framed as something you either have or you don't. The research disagrees: mental toughness is developed through deliberate exposure to challenging situations, learning to tolerate discomfort, and building a track record of following through when it's hard. Every time you finish the last set when you want to quit, every time you show up on a day you don't feel like it — you're building mental toughness."
            },
            {
              title: "Self-Talk and Focus",
              body: "The internal conversation you have during competition and training has measurable effects on performance. Negative self-talk ('I can't do this,' 'I'm too tired') increases perceived exertion and reduces endurance and power. Instructional self-talk ('drive through the floor,' 'keep your chest up') improves technique during skill execution. Motivational self-talk ('I've trained for this,' 'one more rep') sustains effort under fatigue. The quality of your mental commentary matters."
            },
            {
              title: "Controlling the Controllables",
              body: "Elite athletes develop the ability to focus only on what they can control: their effort, their preparation, their attitude, their execution. Uncontrollable factors — officiating, weather, what another team does, how coaches perceive them — are energy drains when focused on. Athletes who redirect energy from what they can't control to what they can consistently perform more reliably under pressure."
            }
          ]
        },
        keyTakeaways: [
          "A growth mindset — believing abilities can be developed — outperforms fixed mindset over time.",
          "Mental toughness is built through repeated exposure to challenge, not innate talent.",
          "The quality of your self-talk affects performance — negative talk hurts, instructional and motivational talk helps.",
          "Focus only on controllables: effort, preparation, attitude, execution."
        ],
        quiz: [
          {
            question: "What characterizes a growth mindset in an athlete?",
            options: [
              "Believing that talent alone determines athletic success",
              "Avoiding challenges to protect current ability and self-image",
              "Believing abilities can be developed through effort and that challenges are opportunities",
              "Only focusing on outcomes like wins and records"
            ],
            correctAnswer: 2,
            explanation: "Growth mindset athletes believe their abilities can be developed through effort and treat challenges as learning opportunities rather than threats to their identity."
          },
          {
            question: "Which type of self-talk is most effective for improving technique during skill execution?",
            options: [
              "Motivational self-talk ('I've trained for this')",
              "Negative self-talk ('I always mess this up')",
              "Instructional self-talk ('drive through the floor', 'keep chest up')",
              "Emotional self-talk ('I love this sport')"
            ],
            correctAnswer: 2,
            explanation: "Research shows instructional self-talk (specific cues related to technique) is most effective for improving skill execution, while motivational self-talk is better for sustaining effort under fatigue."
          },
          {
            question: "What does 'controlling the controllables' mean for an athlete?",
            options: [
              "Trying to influence officiating and opponent behavior through aggression",
              "Focusing only on effort, preparation, attitude, and execution — not uncontrollable factors",
              "Controlling your emotions by never showing any reaction during competition",
              "Managing your teammates' behavior and focus during games"
            ],
            correctAnswer: 1,
            explanation: "Focusing on controllables (effort, attitude, preparation, execution) and redirecting energy away from uncontrollables (officiating, weather, opponents) leads to more consistent performance under pressure."
          }
        ]
      },
      {
        moduleNumber: 2,
        title: "Team Standards and Accountability",
        description: "Understand what it means to be a great teammate and why team culture determines team performance.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "Culture Is How a Team Behaves When No One Is Watching",
              body: "Team standards are not the rules the coaches post on the wall — they're the behaviors the team consistently reinforces through social norms. A team with a strong culture holds every member to the same standard whether the coaches are in the room or not. Players who cut corners in warm-ups, slack on conditioning, or show up unprepared are sending a message: the standard doesn't apply to me. That message is contagious — in the wrong direction."
            },
            {
              title: "Accountability: Being Reliable",
              body: "Accountability in a team context means doing what you said you would do, when you said you would do it — consistently. That means showing up on time, prepared, and ready to work every single session. It means communicating when you can't make it instead of just not showing up. It means doing the work outside of team sessions that you committed to. Unreliable athletes create friction that drags teams down even when they're physically gifted."
            },
            {
              title: "How to Hold Teammates Accountable (Without Becoming the Police)",
              body: "High-functioning teams develop the ability to hold each other accountable without a single athlete becoming the enforcer or creating resentment. This starts with relationship — you earn the right to challenge a teammate by consistently meeting the standard yourself and demonstrating you care about their development. Accountability delivered from a place of genuine care lands differently than criticism delivered from a place of superiority."
            },
            {
              title: "Your Role Changes as You Develop",
              body: "As you become more experienced and more capable, your role on the team evolves. Early in your development, you focus on learning the system, meeting the standard, and building trust. As you establish yourself, you become a model for newer athletes. Eventually, you're expected to actively shape culture — reinforcing standards, developing teammates, and elevating those around you. Great teams have multiple athletes who see this as part of their job."
            }
          ]
        },
        keyTakeaways: [
          "Team culture is defined by what athletes consistently do when no one is watching — not posted rules.",
          "Accountability means being reliably consistent — doing what you said, when you said.",
          "Earn the right to challenge teammates by consistently meeting the standard yourself first.",
          "Your team role evolves — eventually, shaping culture is part of your job."
        ],
        quiz: [
          {
            question: "What best defines team culture in a high-performance athletic context?",
            options: [
              "The rules and policies written by the coaching staff",
              "The behaviors the team consistently reinforces through social norms, with or without coaches present",
              "The win-loss record and public reputation of the program",
              "The talent level of the top athletes on the roster"
            ],
            correctAnswer: 1,
            explanation: "Team culture is defined by the consistent behaviors that team members reinforce through social norms — what happens when coaches aren't watching is the truest measure of a team's standards."
          },
          {
            question: "What does true accountability look like in a team setting?",
            options: [
              "Calling out teammates loudly in front of the group when they underperform",
              "Doing your own work perfectly while ignoring what others do",
              "Consistently following through on commitments and communicating proactively when issues arise",
              "Only showing accountability during games, not in practice"
            ],
            correctAnswer: 2,
            explanation: "True accountability is about consistency — showing up prepared, following through on commitments, and communicating proactively. It's demonstrated daily through small actions, not grand gestures."
          },
          {
            question: "What is the prerequisite for effectively challenging a teammate to meet a higher standard?",
            options: [
              "Being the most physically gifted athlete on the team",
              "Having the most seniority or experience in the program",
              "Consistently meeting the standard yourself and demonstrating genuine care for their development",
              "Getting permission from the coaching staff first"
            ],
            correctAnswer: 2,
            explanation: "You earn the right to challenge teammates through your own consistent behavior and through relationship. Accountability coming from a place of care and personal example lands as motivation, not criticism."
          }
        ]
      },
      {
        moduleNumber: 3,
        title: "Goal Setting for Athletes",
        description: "Learn how to set goals that actually drive behavior — and how to avoid the common goal-setting mistakes that lead nowhere.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "Why Most Athletic Goals Fail",
              body: "Most athletes set goals that are either too vague ('get faster'), too outcome-focused ('make varsity'), or set and forgotten. Goals only change behavior when they are specific, measurable, connected to a plan of action, and reviewed regularly. A goal with no system behind it is just a wish."
            },
            {
              title: "Process Goals vs. Outcome Goals",
              body: "Outcome goals focus on a result: 'I want to bench 225 lbs.' Process goals focus on the behaviors that lead to that result: 'I will attend every training session, hit my protein target daily, and sleep 8+ hours.' The paradox of goal setting is that athletes who obsess over outcomes often achieve less than athletes who obsess over process. Outcomes are the byproduct of consistent process — focus there first."
            },
            {
              title: "Short, Medium, and Long-Term Goals",
              body: "Effective goal architecture has three layers. Long-term goals (6–12 months) provide direction and motivation. Medium-term goals (4–8 weeks) break the journey into achievable milestones. Short-term goals (1 week) are the specific daily and weekly behaviors you'll execute. When the weekly behaviors are aligned with the medium milestones and the long-term vision, the system works. Athletes who only have long-term goals often lose motivation in the middle."
            },
            {
              title: "Reviewing and Adjusting Your Goals",
              body: "Goals should be revisited regularly — at least monthly. Life changes, training evolves, and circumstances shift. A goal set in September may be irrelevant or unrealistic by January. Review what you've achieved, what's changed, and whether your process goals still serve your long-term direction. Adjusting a goal based on new information is intelligence — not failure."
            }
          ]
        },
        keyTakeaways: [
          "Goals only change behavior when specific, measurable, action-connected, and reviewed regularly.",
          "Process goals (behaviors) drive outcomes more reliably than focusing on outcomes alone.",
          "Use a three-layer goal structure: long-term direction, medium milestones, short-term weekly behaviors.",
          "Review and adjust goals regularly — adapting a goal is smart, not a failure."
        ],
        quiz: [
          {
            question: "Which type of goal is most likely to drive consistent daily behavior change?",
            options: [
              "Outcome goals ('I want to squat 300 lbs')",
              "Vague aspiration goals ('I want to be the best')",
              "Process goals ('I will follow the program 4x per week and sleep 8 hours nightly')",
              "Goals set at the start of the year and never revisited"
            ],
            correctAnswer: 2,
            explanation: "Process goals specify the daily behaviors that lead to outcomes, making them directly actionable. Outcomes follow from consistent process — athletes who focus on process achieve more than those who fixate on outcomes."
          },
          {
            question: "What is the purpose of short-term (weekly) goals in a goal-setting system?",
            options: [
              "To replace medium and long-term goals with smaller targets",
              "To provide specific, executable behaviors that drive progress toward larger milestones",
              "To give athletes flexibility to change direction week by week",
              "To satisfy coaches who require weekly progress reports"
            ],
            correctAnswer: 1,
            explanation: "Short-term weekly goals define the specific behaviors to execute that week, providing the bridge between long-term vision and daily action. Without them, long-term goals lack a mechanism to drive behavior."
          },
          {
            question: "Why should athletes review and adjust their goals regularly?",
            options: [
              "Because changing goals frequently prevents complacency",
              "Because coaches require monthly goal updates for program evaluation",
              "Because circumstances change and goals should reflect current reality and learning",
              "Because original goals are always set too high"
            ],
            correctAnswer: 2,
            explanation: "Life, training, and circumstances change over time. Regular goal reviews allow athletes to acknowledge progress, adjust for new realities, and ensure current process goals still serve long-term direction."
          }
        ]
      }
    ]
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 7. INJURY PREVENTION BASICS
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "default-pathway-injury-prevention",
    title: "Injury Prevention Basics",
    slug: "injury-prevention-basics",
    category: "injury_prevention",
    description: "Education-only overview of how common athletic injuries happen, how movement quality and recovery habits reduce risk, and when to seek professional evaluation. This content is not medical advice, diagnosis, or treatment guidance.",
    modules: [
      {
        moduleNumber: 1,
        title: "How Injuries Happen",
        description: "Understand the most common mechanisms of athletic injury so you can recognize risk factors before they become problems.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "Two Categories: Acute and Overuse",
              body: "Athletic injuries fall into two broad categories. Acute injuries happen suddenly — a tackle, a bad landing, a single explosive movement that exceeds tissue capacity. Overuse injuries develop gradually over time as repetitive stress accumulates in a tissue faster than that tissue can recover and remodel. While acute injuries are often unpredictable, overuse injuries are frequently the result of training errors that could have been avoided. Understanding both categories helps athletes and coaches make better decisions. This module provides general education — any suspected injury should be evaluated by a qualified healthcare professional."
            },
            {
              title: "Common Overuse Injury Risk Factors",
              body: "The most common contributors to overuse injuries are: (1) Too much, too soon — increasing training volume or intensity faster than the body can adapt. (2) Insufficient recovery — not allowing tissue to repair between sessions. (3) Movement imbalances — weakness or tightness in supporting muscle groups that places excessive load on primary structures. (4) Poor training surface or equipment. (5) Ignoring early warning signs — training through discomfort that signals tissue stress. Athletes who understand these factors can often prevent overuse injuries before they become serious."
            },
            {
              title: "The Role of Accumulated Load",
              body: "Every training session adds to your cumulative tissue load. When that load consistently exceeds the tissue's capacity to recover, stress accumulates — first as discomfort, then as dysfunction, then as injury. This is why athletes are typically most vulnerable during periods of rapid training load increases: preseason camps, transition from off-season to in-season, or returning from illness. The body needs time to adapt to new demands — give it that time."
            },
            {
              title: "Recognizing Early Warning Signs",
              body: "Overuse injuries rarely appear from nowhere. They are typically preceded by early signals: localized tenderness, stiffness that doesn't resolve with warm-up, mild pain that shows up during specific movements, and swelling or warmth around a joint or tendon. Athletes who learn to recognize and communicate these early signals — and who seek appropriate evaluation promptly — typically have much faster and more complete recoveries than those who train through warning signs until the injury is severe."
            }
          ]
        },
        keyTakeaways: [
          "Injuries are acute (sudden trauma) or overuse (gradual accumulation) — most overuse injuries are preventable.",
          "Key overuse risk factors: too much too soon, inadequate recovery, movement imbalances, and ignoring early signals.",
          "Periods of rapid load increases carry the highest injury risk — adapt training loads gradually.",
          "Early warning signs (localized tenderness, stiffness, mild pain during specific movements) should prompt evaluation, not training through."
        ],
        quiz: [
          {
            question: "What is the primary difference between acute and overuse injuries?",
            options: [
              "Acute injuries are more serious and take longer to heal",
              "Overuse injuries happen only in endurance athletes",
              "Acute injuries occur suddenly from a single event; overuse injuries develop gradually from repetitive stress",
              "Acute injuries never require professional medical evaluation"
            ],
            correctAnswer: 2,
            explanation: "Acute injuries result from a single sudden event (fall, collision, etc.) while overuse injuries build gradually as repetitive stress accumulates beyond the tissue's recovery capacity."
          },
          {
            question: "Which of the following is NOT a common risk factor for overuse injuries?",
            options: [
              "Increasing training volume too rapidly",
              "Insufficient recovery between sessions",
              "Competing in multiple sports throughout the year",
              "Gradually progressing load following a structured program"
            ],
            correctAnswer: 3,
            explanation: "Gradual, structured progression actually reduces overuse injury risk by giving tissues time to adapt. The risk factors are rapid increases, insufficient recovery, movement imbalances, and ignoring early warning signs."
          },
          {
            question: "Why are athletes most vulnerable to overuse injury during periods of rapid training load increases?",
            options: [
              "Because rapid increases improve fitness too quickly for the joints to handle",
              "Because tissues need time to adapt — rapid increases accumulate stress faster than recovery can occur",
              "Because coaches require maximum effort during preseason camps",
              "Because athletes forget to stretch during periods of high training volume"
            ],
            correctAnswer: 1,
            explanation: "Tissue adaptation takes time. When training load increases faster than tissues can recover and remodel, cumulative stress accumulates until it exceeds the tissue's structural capacity — resulting in injury."
          }
        ]
      },
      {
        moduleNumber: 2,
        title: "Movement Quality and Injury Risk",
        description: "Learn how movement mechanics and muscle imbalances affect injury risk — and why technique is about more than just performance.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "Technique Is Protection",
              body: "Good movement technique is not just about efficiency and performance — it's one of the primary protections against injury. When joints move through their intended range of motion under appropriate load, stress is distributed across supporting structures as designed. When technique breaks down — from fatigue, rushing, or inadequate skill development — stress concentrates in ways that tissues are not built to handle. This is particularly important in landing mechanics, hip hinge patterns, and overhead pressing."
            },
            {
              title: "Muscle Imbalances and Compensation Patterns",
              body: "Muscle imbalances occur when certain muscles are significantly stronger, weaker, tighter, or more inhibited than their paired antagonists or stabilizers. Common examples include: tight hip flexors and weak glutes in athletes who sit a lot, dominant quads with underdeveloped hamstrings, or weak external rotators in the shoulder. When imbalances exist, the body compensates — other structures take on loads they're not designed for, increasing injury risk over time."
            },
            {
              title: "Fatigue and Technique Breakdown",
              body: "Even athletes with excellent technique in fresh conditions see mechanics degrade under fatigue. Late in a game, at the end of a hard training session, or during the final reps of a heavy set — this is when injury risk peaks. Coaches watch for form breakdown as a signal to reduce load or end a set. Athletes should develop the body awareness to recognize when their own technique is degrading and communicate that to their coach."
            },
            {
              title: "The Role of Strength Training in Injury Prevention",
              body: "Appropriate strength and conditioning work — not just sport practice — is one of the most evidence-supported tools for reducing injury rates in athletes. Strong muscles, tendons, and connective tissue handle loads better. Targeted strengthening of commonly weak areas (glutes, rotator cuff, hip external rotators, hamstrings) directly addresses the imbalances that lead to injury. This is why strength training is not optional for athletes who want to stay healthy."
            }
          ]
        },
        keyTakeaways: [
          "Good movement technique distributes load appropriately — poor technique concentrates stress where it doesn't belong.",
          "Muscle imbalances create compensation patterns that increase injury risk over time.",
          "Fatigue degrades technique — injury risk peaks when form breaks down late in sessions or games.",
          "Strength and conditioning directly reduces injury risk by building tissue capacity and correcting imbalances."
        ],
        quiz: [
          {
            question: "Why does movement technique directly affect injury risk?",
            options: [
              "Correct technique makes athletes faster, which reduces collision risk",
              "Correct technique distributes load appropriately; poor technique concentrates stress where tissues can't handle it",
              "Poor technique only matters in advanced strength movements like Olympic lifts",
              "Technique affects aesthetic performance but not injury risk"
            ],
            correctAnswer: 1,
            explanation: "Good technique ensures that load is distributed across the structures designed to handle it. When mechanics break down, stress concentrates in ways that can exceed tissue capacity and lead to injury."
          },
          {
            question: "What is a muscle imbalance?",
            options: [
              "Having one arm stronger than the other from dominant-side use",
              "A significant discrepancy in strength, flexibility, or activation between paired or stabilizing muscle groups",
              "Training one muscle group more times per week than another",
              "Using more weight on one side of a barbell by mistake"
            ],
            correctAnswer: 1,
            explanation: "Muscle imbalances are significant differences in strength, flexibility, or neuromuscular activation between muscles that should work in balance — creating compensation patterns that stress joints and tendons."
          },
          {
            question: "When is injury risk highest during a training session or competition?",
            options: [
              "During the warm-up before the body is ready",
              "At the peak of physical conditioning in midseason",
              "Late in sessions or games when fatigue degrades technique and tissue capacity",
              "During low-intensity drills that don't challenge the athlete"
            ],
            correctAnswer: 2,
            explanation: "Fatigue reduces both neuromuscular control (increasing technique breakdown) and tissue capacity. This is why injury rates spike late in games and at the end of hard training sessions."
          }
        ]
      }
    ]
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 8. RECRUITING EDUCATION
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "default-pathway-recruiting",
    title: "Recruiting Education",
    slug: "recruiting-education",
    category: "recruiting",
    description: "Navigate the college recruiting process with confidence. This pathway covers the recruiting timeline, building your athletic profile, communicating with coaches, NCAA eligibility, academic requirements, and campus visits.",
    modules: [
      {
        moduleNumber: 1,
        title: "Understanding the Recruiting Timeline",
        description: "Learn when recruiting activities can legally begin, what coaches are looking for at each stage, and how to plan your approach.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "Recruiting Doesn't Start When You Think",
              body: "Many athletes believe recruiting ramps up in their junior or senior year. In most sports, serious recruiting activity — in terms of coaches actively recruiting — begins in the sophomore year or earlier for Division I programs, and the recruiting timeline continues to compress. Understanding when coaches can contact you, when you can visit, and when scholarship offers typically come gives you a strategic advantage in managing the process."
            },
            {
              title: "NCAA Contact and Evaluation Rules",
              body: "The NCAA has specific rules about when and how college coaches can contact recruits — rules that change regularly. Generally, coaches can begin sending written materials early but have restrictions on phone calls, official visits, and in-person contact until certain dates. It is your responsibility as a recruit to understand the current rules for your specific sport and division. The NCAA Eligibility Center website (eligibilitycenter.org) is the authoritative source — always verify current rules there."
            },
            {
              title: "What Coaches Are Looking for at Each Stage",
              body: "Freshman/Sophomore Year: Coaches are looking for raw potential, academic trajectory, character, and coachability. They want to know if you're doing the right things. Junior Year: Athletic performance data (times, stats, film), GPA, test scores, and proactive communication become critical. This is often when offers are made for top-tier prospects. Senior Year: Many offers come during this period for mid-major and Division III programs. Staying visible and proactively communicating with programs remains important throughout."
            },
            {
              title: "Being Realistic and Expanding Your Target List",
              body: "One of the most common recruiting mistakes is narrowing the target list too early — pursuing only high-profile programs while ignoring excellent programs at lower divisions where a recruit might be a better fit academically, athletically, and culturally. Division II, Division III, NAIA, and junior college programs offer scholarships, great coaching, and paths to professional play in many sports. The best fit is not always the biggest name — it's where you'll develop most and have the best overall experience."
            }
          ]
        },
        keyTakeaways: [
          "Serious recruiting begins earlier than most athletes expect — proactive outreach from athletes matters.",
          "NCAA contact rules are sport- and division-specific — verify current rules at eligibilitycenter.org.",
          "Junior year is often the most critical period for athletic and academic positioning.",
          "Broaden your target list — the best program for you may not be the most famous one."
        ],
        quiz: [
          {
            question: "When does serious Division I recruiting activity typically begin for most sports?",
            options: [
              "Only during the senior year of high school",
              "Starting in the 8th grade for all sports",
              "As early as the sophomore year for many programs",
              "College coaches cannot actively recruit until an athlete submits a college application"
            ],
            correctAnswer: 2,
            explanation: "For many Division I sports, coaches begin actively evaluating and recruiting athletes as early as sophomore year in high school — making early preparation and visibility important."
          },
          {
            question: "Where should athletes verify current NCAA recruiting contact rules for their specific sport?",
            options: [
              "High school coaching staff or athletic director",
              "The official NCAA Eligibility Center website (eligibilitycenter.org)",
              "Social media posts from college coaches",
              "Recruiting services that charge monthly fees"
            ],
            correctAnswer: 1,
            explanation: "NCAA rules change regularly and vary by sport and division. The NCAA Eligibility Center (eligibilitycenter.org) is the authoritative, up-to-date source for recruiting rules."
          },
          {
            question: "Why is it important to maintain a broader target school list rather than focusing on only top-tier programs?",
            options: [
              "Top programs never offer athletic scholarships",
              "Coaches at top programs don't recruit athletes who contact them first",
              "The best developmental and cultural fit may be at a program that isn't the most high-profile",
              "Division III programs offer more scholarships than Division I"
            ],
            correctAnswer: 2,
            explanation: "The best fit for an athlete — in terms of playing time, development, academic environment, and culture — is often at a program that's not the biggest name. Narrowing focus too early limits options significantly."
          }
        ]
      },
      {
        moduleNumber: 2,
        title: "Building Your Athletic Profile",
        description: "Learn how to create a compelling recruiting profile that gets noticed by college coaches.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "Your Profile Is Your First Impression",
              body: "A recruiting profile is often the first thing a college coach sees before they ever watch your film or read a single number. It needs to communicate who you are as an athlete and a person clearly and professionally. This includes: your basic information (name, contact, graduation year, position), academic information (GPA, SAT/ACT scores, intended major), athletic performance data (measurables, stats, accomplishments), and contact information for your high school or club coach."
            },
            {
              title: "Athletic Measurables That Matter",
              body: "Different sports value different measurables. For most field and court sports: height, weight, 40-yard dash time, vertical jump, and position-specific skill metrics are common. For strength athletes: competition totals and training maxes are relevant. Whatever your sport, know your current numbers and have them ready. Coaches want athletes who know their performance data — it shows self-awareness and professionalism."
            },
            {
              title: "Highlight Film: Quality Over Quantity",
              body: "For sports that use film, your highlight reel should be 3–5 minutes maximum. Lead with your 3–5 best plays in the first 60 seconds — coaches watch many videos and often make decisions quickly. Include a variety of plays that showcase athleticism, decision-making, and coachability (following a set play correctly, executing a block assignment, etc.). Film should be well-edited, clearly labeled with your name and number, and hosted somewhere easy to share (Hudl, YouTube)."
            },
            {
              title: "References and Character Documentation",
              body: "College coaches do not recruit athletes who create problems — they recruit athletes who make programs better. Letters of recommendation from coaches who can speak to your work ethic, coachability, and character carry significant weight. Choose references who know you well and can speak specifically about your behavior in adversity, how you handle mistakes, and how you treat teammates. A generic letter of recommendation from a teacher does less than a specific one from a coach who has seen your character tested."
            }
          ]
        },
        keyTakeaways: [
          "Your recruiting profile is your first impression — make it complete, professional, and specific.",
          "Know your measurables for your sport — coaches expect self-aware athletes.",
          "Highlight film should lead with your best plays; keep it to 3–5 minutes maximum.",
          "Character references from coaches who've seen your behavior tested are highly valuable."
        ],
        quiz: [
          {
            question: "How long should an athletic recruiting highlight reel be?",
            options: [
              "10–15 minutes to show full game footage",
              "30–60 minutes showing an entire game",
              "3–5 minutes, leading with best plays in the first 60 seconds",
              "1 minute or less — coaches only watch a few seconds"
            ],
            correctAnswer: 2,
            explanation: "Coaches evaluate many recruiting videos. A 3–5 minute highlight reel that leads with your best plays captures attention quickly and respects their time — longer videos often go unwatched."
          },
          {
            question: "What does knowing your athletic measurables communicate to a college coach?",
            options: [
              "That you have already hired a professional recruiting service",
              "Self-awareness and professionalism — you track your own performance data",
              "That you are too focused on statistics rather than team play",
              "That you have been evaluated by multiple college programs"
            ],
            correctAnswer: 1,
            explanation: "Athletes who know their measurables demonstrate self-awareness and professionalism. Coaches value recruits who are analytically engaged with their own development."
          },
          {
            question: "What makes a character reference most valuable in the recruiting process?",
            options: [
              "The title or prestige of the person writing the reference",
              "That it's from a teacher who knows you academically",
              "That it's specific, comes from a coach, and speaks to behavior in adversity and with teammates",
              "That it's one page or less in length"
            ],
            correctAnswer: 2,
            explanation: "College coaches want to know how an athlete behaves when things are hard and how they treat teammates. Specific character references from coaches who've witnessed this carry more weight than generic letters from less relevant references."
          }
        ]
      },
      {
        moduleNumber: 3,
        title: "Communicating with College Coaches",
        description: "Learn how to reach out professionally, follow up effectively, and build relationships with coaching staffs.",
        estimatedMinutes: 10,
        content: {
          sections: [
            {
              title: "You Must Be Proactive",
              body: "A common misconception is that great talent gets 'found.' While it does happen, most successful recruits are proactively communicating with programs — especially at the Division II, III, and NAIA levels. Waiting to be discovered is a passive strategy. Reaching out to coaches directly, professionally, and persistently is not presumptuous — it's expected. Coaches respect recruits who show genuine interest and initiative."
            },
            {
              title: "The First Email: How to Stand Out",
              body: "Your first email to a coach should be concise, professional, and specific to their program. Template: (1) Brief introduction — name, graduation year, position, high school. (2) A specific reason you're interested in their program (coaching staff, academic reputation, play style, facility). (3) A link to your profile and highlight film. (4) Your contact information and a request to speak further. One to two paragraphs maximum. Coaches receive hundreds of emails — a clear, specific, professional message stands out."
            },
            {
              title: "Following Up Without Being Annoying",
              body: "If you don't hear back in 2–3 weeks, a polite follow-up email is entirely appropriate. Coaches are busy — they miss emails, forget to respond, and go through periods of intense travel. Following up once or twice demonstrates persistence without harassment. Vary the medium occasionally — an email, then a physical letter, then another email — to stay visible. If a coach consistently does not respond after 3–4 attempts over a few months, they may not be recruiting at your level for your position. Reassess your list."
            },
            {
              title: "How to Behave on Recruiting Calls",
              body: "When a coach calls or schedules time to speak, treat it professionally. Be somewhere quiet, have your questions prepared, and be an active participant in the conversation — not just answering questions. Ask about the program culture, player development, academic support, what the coach looks for in your position, and what the timeline looks like. Taking notes shows engagement. Coaches are evaluating your communication skills and maturity as much as your athletic profile."
            }
          ]
        },
        keyTakeaways: [
          "Proactive outreach is expected — waiting to be 'found' is a passive strategy that limits opportunities.",
          "First emails should be concise, specific to the program, and include your profile link.",
          "Politely following up 2–4 times over a few months is appropriate persistence — not harassment.",
          "Recruiting calls are two-way evaluations — ask prepared questions and take notes."
        ],
        quiz: [
          {
            question: "Why is proactive outreach important in the college recruiting process?",
            options: [
              "Coaches are required by NCAA rules to respond to every athlete who contacts them",
              "Most talent is not 'discovered' — coaches respect recruits who show genuine initiative",
              "Proactive outreach guarantees a scholarship offer from any program you contact",
              "It's only necessary for athletes targeting Division III programs"
            ],
            correctAnswer: 1,
            explanation: "Most recruits who land offers — especially at Division II and below — initiated the conversation themselves. Proactive, professional outreach demonstrates initiative and genuine interest, which coaches value."
          },
          {
            question: "What should your first email to a college coach include?",
            options: [
              "Your GPA, a three-page essay about your goals, and every award you've won",
              "A brief professional introduction, specific interest in their program, profile/film link, and contact info",
              "A request for a scholarship and available scholarship amounts",
              "A long list of every program you're also talking to"
            ],
            correctAnswer: 1,
            explanation: "First emails should be concise (1–2 paragraphs), professional, and program-specific. Coaches receive hundreds of emails — being specific about why you're interested in their program helps you stand out."
          },
          {
            question: "What does it likely signal if a coach consistently does not respond after 3–4 professional outreach attempts over a few months?",
            options: [
              "You should contact the coach's supervisor to escalate the issue",
              "The coach is definitely interested but has been too busy to respond",
              "That program may not be actively recruiting at your level or position — reassess your list",
              "You should show up in person to the program to make a stronger impression"
            ],
            correctAnswer: 2,
            explanation: "Coaches who are actively recruiting a prospect typically respond. Persistent non-response after professional follow-ups is usually a signal that the program is not recruiting at your level or position — an important data point for prioritizing your target list."
          }
        ]
      },
      {
        moduleNumber: 4,
        title: "NCAA Eligibility and Academic Standards",
        description: "Understand what it takes to be eligible to compete at the college level and how to protect your eligibility from the start.",
        estimatedMinutes: 8,
        content: {
          sections: [
            {
              title: "NCAA Eligibility Is Not Automatic",
              body: "Many athletes assume that if they get into college and make a team, they're automatically eligible to compete. This is not true. The NCAA Eligibility Center independently certifies recruits based on academic and amateurism requirements. Failing to register or meet these requirements — even if you've signed with a program — can result in sitting out a full season or losing eligibility entirely. Register at the NCAA Eligibility Center (eligibilitycenter.org) early — sophomore year is not too soon."
            },
            {
              title: "Core Course Requirements",
              body: "Division I and Division II programs require completion of a specific set of 'core courses' in high school — typically English, math, science, social science, and foreign language. Not every class on your high school transcript counts. Classes must be on your school's approved list. Check your course selection against these requirements every year — don't wait until senior year to find out you're short on core courses. Division III does not use the NCAA Eligibility Center but has its own admissions standards."
            },
            {
              title: "GPA and Test Scores: The Sliding Scale",
              body: "Division I uses a sliding scale that balances GPA and standardized test scores — a higher GPA can offset a lower test score, and vice versa. Division II has its own minimum GPA and test score requirements. The key takeaway: even athletes with outstanding physical ability must meet academic minimums to be eligible. Prioritizing academics is not separate from athletic ambition — it is required by it."
            },
            {
              title: "Amateurism Rules",
              body: "The NCAA's amateurism rules dictate that prospective student-athletes cannot accept payment, benefits, or professional contracts related to their athletic ability in ways that violate NCAA rules. Accepting improper benefits — even unknowingly — can jeopardize eligibility. The landscape around Name, Image, and Likeness (NIL) is evolving rapidly. Consult the NCAA Eligibility Center or a qualified advisor before accepting any payment or endorsement related to your athletic participation."
            }
          ]
        },
        keyTakeaways: [
          "NCAA eligibility is certified independently — register at eligibilitycenter.org in sophomore year.",
          "Not all high school classes count as 'core courses' — verify annually against requirements.",
          "Division I uses a GPA/test score sliding scale — academic minimums are required regardless of athletic ability.",
          "Accepting improper benefits related to athletic ability can jeopardize NCAA eligibility."
        ],
        quiz: [
          {
            question: "When should an athlete register with the NCAA Eligibility Center?",
            options: [
              "Only after receiving a scholarship offer",
              "During the senior year when applying to colleges",
              "As early as sophomore year — well before the recruiting process peaks",
              "After committing to a specific college program"
            ],
            correctAnswer: 2,
            explanation: "Registering early (sophomore year) gives athletes time to identify and correct any eligibility issues — missing core courses, low test scores — before they become disqualifying factors."
          },
          {
            question: "What is the NCAA 'sliding scale' for Division I eligibility?",
            options: [
              "A scale that determines scholarship amounts based on athletic performance",
              "A balance between GPA and standardized test scores where higher GPA offsets lower test scores",
              "A system that increases allowable practice hours based on academic performance",
              "A ranking system that determines which programs can recruit a specific athlete"
            ],
            correctAnswer: 1,
            explanation: "Division I uses a sliding scale that allows a higher GPA to offset a lower standardized test score, and vice versa — ensuring athletes meet minimum academic benchmarks through either pathway."
          },
          {
            question: "What should an athlete do before accepting any NIL-related payment or endorsement?",
            options: [
              "Ask a parent or guardian to review the agreement",
              "Proceed as long as the payment seems reasonable",
              "Consult the NCAA Eligibility Center or a qualified advisor — NIL rules are complex and evolving",
              "Check with teammates who have accepted similar deals"
            ],
            correctAnswer: 2,
            explanation: "NIL rules are complex, sport-specific, and evolving rapidly. Accepting an improper benefit — even unknowingly — can jeopardize NCAA eligibility. Always consult the NCAA Eligibility Center or a qualified advisor first."
          }
        ]
      }
    ]
  }
];

// ─── Seed Function ────────────────────────────────────────────────────────────

export async function seedDefaultEducationLibrary() {
  try {
    // Check if already seeded — use first pathway's ID
    const [existing] = await db
      .select()
      .from(educationPathways)
      .where(eq(educationPathways.id, "default-pathway-nutrition"))
      .limit(1);

    if (existing) {
      console.log("[Education Seed] Default education library already seeded, skipping.");
      return;
    }

    console.log("[Education Seed] Seeding default education library...");

    for (const pathwaySeed of DEFAULT_PATHWAYS) {
      // Insert pathway
      await db.insert(educationPathways).values({
        id: pathwaySeed.id,
        orgId: null,
        createdByUserId: null,
        title: pathwaySeed.title,
        slug: pathwaySeed.slug,
        category: pathwaySeed.category,
        description: pathwaySeed.description,
        status: "published",
        isDefault: true,
      }).onConflictDoNothing();

      console.log(`[Education Seed] Pathway created: ${pathwaySeed.title}`);

      for (const mod of pathwaySeed.modules) {
        // Insert module
        const [insertedModule] = await db.insert(educationModules).values({
          orgId: null,
          pathwayId: pathwaySeed.id,
          moduleNumber: mod.moduleNumber,
          title: mod.title,
          description: mod.description,
          content: mod.content,
          keyTakeaways: mod.keyTakeaways,
          estimatedMinutes: mod.estimatedMinutes,
          status: "published",
        }).returning({ id: educationModules.id });

        if (!insertedModule) {
          console.warn(`[Education Seed] Could not insert module: ${mod.title}`);
          continue;
        }

        console.log(`[Education Seed]   Module ${mod.moduleNumber}: ${mod.title}`);

        // Insert quiz questions
        for (const q of mod.quiz) {
          await db.insert(educationQuizQuestions).values({
            orgId: null,
            pathwayId: pathwaySeed.id,
            moduleId: insertedModule.id,
            question: q.question,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
          });
        }

        console.log(`[Education Seed]     ${mod.quiz.length} quiz questions added`);
      }
    }

    console.log("[Education Seed] Default education library seeded successfully!");

    // ── Seed default badges (one per pathway) ────────────────────────────────
    const DEFAULT_BADGES = [
      { pathwayId: "default-pathway-nutrition",         name: "Fueling Certified",          icon: "zap",       color: "emerald", description: "Completed the Nutrition Foundations pathway" },
      { pathwayId: "default-pathway-recovery",          name: "Recovery Ready",              icon: "heart",     color: "blue",    description: "Completed the Recovery & Sleep pathway" },
      { pathwayId: "default-pathway-hydration",         name: "Hydration Champion",          icon: "droplets",  color: "cyan",    description: "Completed the Hydration Mastery pathway" },
      { pathwayId: "default-pathway-training-habits",   name: "Training Habits Pro",         icon: "dumbbell",  color: "violet",  description: "Completed the Training Habits pathway" },
      { pathwayId: "default-pathway-readiness",         name: "Readiness Master",            icon: "activity",  color: "amber",   description: "Completed the Readiness & Recovery pathway" },
      { pathwayId: "default-pathway-mindset",           name: "Mindset Champion",            icon: "brain",     color: "pink",    description: "Completed the Mindset & Mental Performance pathway" },
      { pathwayId: "default-pathway-injury-prevention", name: "Injury Prevention Pro",       icon: "shield",    color: "orange",  description: "Completed the Injury Prevention pathway" },
      { pathwayId: "default-pathway-recruiting",        name: "Recruiting Ready",            icon: "star",      color: "rose",    description: "Completed the Recruiting Excellence pathway" },
    ];

    for (const badge of DEFAULT_BADGES) {
      const existing = await db.select({ id: educationBadges.id }).from(educationBadges)
        .where(and(eq(educationBadges.pathwayId, badge.pathwayId), eq(educationBadges.isDefault, true)))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(educationBadges).values({
          orgId: null,
          pathwayId: badge.pathwayId,
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
          color: badge.color,
          criteria: "pathway_completed",
          isDefault: true,
        });
        console.log(`[Education Seed] Badge seeded: ${badge.name}`);
      }
    }

    console.log("[Education Seed] Default badges seeded.");
  } catch (error) {
    console.error("[Education Seed] Error seeding education library:", error);
    throw error;
  }
}
