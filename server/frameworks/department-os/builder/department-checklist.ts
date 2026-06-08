/**
 * Department OS v2 — Department Checklist
 * Every department must pass all required checklist items before going live.
 * Evaluators auto-detect status where possible from the registry.
 */

import type { RegisteredDepartment } from "../department-types";
import { computeMaturityLevel }      from "./department-template";

// ─── Checklist item ───────────────────────────────────────────────────────────

export type ChecklistCategory =
  | "infrastructure"
  | "intelligence"
  | "operations"
  | "integration"
  | "verification";

export interface ChecklistItem {
  id:          string;
  label:       string;
  category:    ChecklistCategory;
  required:    boolean;
  description: string;
  autoDetect?: (dept: RegisteredDepartment) => boolean;
}

// ─── Master checklist ─────────────────────────────────────────────────────────

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  // Infrastructure
  {
    id:          "db_tables",
    label:       "Database tables created",
    category:    "infrastructure",
    required:    true,
    description: "All domain tables exist (createTables() called on startup)",
  },
  {
    id:          "assessment_agent",
    label:       "Assessment Agent implemented",
    category:    "infrastructure",
    required:    true,
    description: "Scores entities using scoreKeywords() + compositeScore() from the Assessment Framework",
  },
  {
    id:          "coordinator",
    label:       "DepartmentCoordinator implemented",
    category:    "infrastructure",
    required:    true,
    description: "Implements BaseDepartmentCoordinator: runHeartbeatReview, generateSummary, generateBestAction",
    autoDetect:  (dept) => !!dept.coordinator,
  },
  {
    id:          "health_checks",
    label:       "Health checks defined (≥ 3)",
    category:    "infrastructure",
    required:    true,
    description: "runHeartbeatReview() runs at least 3 DepartmentHealthCheck rules",
  },
  {
    id:          "routes",
    label:       "Routes registered inside registerRoutes()",
    category:    "infrastructure",
    required:    true,
    description: "All API endpoints registered in server/routes.ts inside registerRoutes(), not in server/index.ts",
  },
  // Intelligence
  {
    id:          "learning_agent",
    label:       "Learning Agent implemented",
    category:    "intelligence",
    required:    true,
    description: "Maps domain data → Signal → buildLearningReport + generateStandardInsights",
    autoDetect:  (dept) => dept.learningEnabled,
  },
  {
    id:          "executive_agent",
    label:       "Executive Agent implemented",
    category:    "intelligence",
    required:    true,
    description: "Generates ExecutiveBrief + DepartmentRecommendations + BestAction via framework helpers",
    autoDetect:  (dept) => dept.executiveEnabled,
  },
  {
    id:          "best_action",
    label:       "Best Action Today wired",
    category:    "intelligence",
    required:    true,
    description: "generateBestAction() returns ranked BestAction using rankBestActions() + candidate()",
  },
  // Operations
  {
    id:          "admin_ui",
    label:       "Admin UI page built (≥ 6 tabs)",
    category:    "operations",
    required:    true,
    description: "Page at /admin/{name} with Pipeline, Outreach, Assessment, Learning, Executive, Health tabs",
  },
  {
    id:          "sidebar_nav",
    label:       "Sidebar navigation entry added",
    category:    "operations",
    required:    true,
    description: "Department appears in app-sidebar.tsx with correct icon and testId",
  },
  {
    id:          "outreach_agent",
    label:       "Outreach Agent implemented",
    category:    "operations",
    required:    false,
    description: "Generates outreach email drafts for qualified entities via OpenAI",
    autoDetect:  (dept) => dept.outreachEnabled,
  },
  // Integration
  {
    id:          "registry_registered",
    label:       "Registered in Department Registry",
    category:    "integration",
    required:    true,
    description: "departmentRegistry.register(coordinator, meta) called with full meta object",
    autoDetect:  (dept) => dept.enabled,
  },
  {
    id:          "heartbeat",
    label:       "Appears in CEO Heartbeat",
    category:    "integration",
    required:    true,
    description: "CEO Heartbeat runs runHeartbeatReview() on each cycle — automatic once registered",
    autoDetect:  (dept) => dept.enabled,
  },
  {
    id:          "attention_inbox",
    label:       "Attention Inbox alerts wired",
    category:    "integration",
    required:    true,
    description: "departmentHealthEngine.createAttentionItemsFromFailed() called in runHeartbeatReview",
  },
  {
    id:          "best_action_global",
    label:       "Appears in Best Action Today (global)",
    category:    "integration",
    required:    true,
    description: "generateBestAction() is called by CEO Heartbeat and surfaces in the global queue",
    autoDetect:  (dept) => dept.enabled,
  },
  // Verification
  {
    id:          "ts_passes",
    label:       "TypeScript passes — zero errors",
    category:    "verification",
    required:    true,
    description: "tsc --noEmit on all department files produces zero errors",
  },
  {
    id:          "runtime_registered",
    label:       "Runtime registration verified",
    category:    "verification",
    required:    true,
    description: "[DepartmentRegistry] Registered department: <Name> appears in server startup logs",
    autoDetect:  (dept) => dept.enabled,
  },
];

// ─── Evaluated checklist ──────────────────────────────────────────────────────

export interface EvaluatedChecklistItem extends ChecklistItem {
  completed:  boolean;
  autoChecked: boolean;
}

export interface DepartmentChecklist {
  departmentId:     string;
  departmentName:   string;
  items:            EvaluatedChecklistItem[];
  completedCount:   number;
  requiredCount:    number;
  totalCount:       number;
  percentComplete:  number;
  allRequiredDone:  boolean;
}

export function evaluateChecklist(dept: RegisteredDepartment): DepartmentChecklist {
  const items: EvaluatedChecklistItem[] = CHECKLIST_ITEMS.map(item => {
    const autoChecked = item.autoDetect ? item.autoDetect(dept) : false;
    return { ...item, completed: autoChecked, autoChecked };
  });

  const completedCount  = items.filter(i => i.completed).length;
  const requiredCount   = items.filter(i => i.required).length;
  const totalCount      = items.length;
  const allRequiredDone = items.filter(i => i.required).every(i => i.completed);

  return {
    departmentId:    dept.id,
    departmentName:  dept.name,
    items,
    completedCount,
    requiredCount,
    totalCount,
    percentComplete: Math.round((completedCount / totalCount) * 100),
    allRequiredDone,
  };
}
