/**
 * Department OS v2 — Barrel Export
 * Import everything through this file:
 *   import { DepartmentStage, DepartmentCoordinator, ... } from "../frameworks/department-os";
 *
 * v2 adds: pipeline/, assessment/, learning-engine/, executive-engine/, health-engine/
 */

export * from "./department-types";
export * from "./department-lifecycle";
export * from "./department-events";
export * from "./department-health";
export * from "./department-learning";
export * from "./department-executive";
export * from "./department-coordinator";
export * from "./department-recommendations";

// ─── v2 sub-frameworks ────────────────────────────────────────────────────────
// Departments import directly from subdirectory paths to avoid name conflicts:
//   import { PipelineStage }    from ".../department-os/pipeline"
//   import { AssessmentResult } from ".../department-os/assessment"
//   import { Signal, Insight }  from ".../department-os/learning-engine"
//   import { BestActionCandidate, rankBestActions } from ".../department-os/executive-engine"
//   import { DepartmentHealthEngine } from ".../department-os/health-engine"
