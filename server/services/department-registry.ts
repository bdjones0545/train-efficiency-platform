/**
 * Department Registry — CEO Heartbeat Integration Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all registered AI departments.
 * The CEO Heartbeat loops through this registry on every cycle.
 * New departments register here once and automatically inherit heartbeat
 * integration, attention inbox alerts, and CEO dashboard visibility.
 *
 * Usage:
 *   departmentRegistry.register(myDepartmentCoordinator, { name: "...", ... });
 *   departmentRegistry.getEnabledDepartments();  // called by CEO Heartbeat
 */

import type {
  DepartmentCoordinator,
  HeartbeatReviewResult,
} from "../frameworks/department-os";
import type { RegisteredDepartment } from "../frameworks/department-os/department-types";

// ─── Registry entry ────────────────────────────────────────────────────────────

interface RegistryEntry {
  department:    RegisteredDepartment;
  coordinator:   DepartmentCoordinator;
}

// ─── Registry class ────────────────────────────────────────────────────────────

class DepartmentRegistry {
  private entries = new Map<string, RegistryEntry>();

  register(
    coordinator: DepartmentCoordinator,
    meta: {
      name:                  string;
      description?:          string;
      version?:              string;
      enabled?:              boolean;
      discoveryEnabled?:     boolean;
      qualificationEnabled?: boolean;
      outreachEnabled?:      boolean;
      executionEnabled?:     boolean;
      learningEnabled?:      boolean;
      executiveEnabled?:     boolean;
    },
  ): void {
    const entry: RegistryEntry = {
      coordinator,
      department: {
        id:                    coordinator.departmentId,
        name:                  meta.name,
        description:           meta.description ?? "",
        version:               meta.version ?? "1.0.0",
        enabled:               meta.enabled ?? true,
        registeredAt:          new Date(),
        discoveryEnabled:      meta.discoveryEnabled ?? true,
        qualificationEnabled:  meta.qualificationEnabled ?? true,
        outreachEnabled:       meta.outreachEnabled ?? true,
        executionEnabled:      meta.executionEnabled ?? true,
        learningEnabled:       meta.learningEnabled ?? true,
        executiveEnabled:      meta.executiveEnabled ?? true,
        coordinator,
      },
    };
    this.entries.set(coordinator.departmentId, entry);
    console.log(`[DepartmentRegistry] Registered department: ${meta.name} (${coordinator.departmentId})`);
  }

  getAll(): RegisteredDepartment[] {
    return Array.from(this.entries.values()).map(e => e.department);
  }

  getEnabledDepartments(): Array<{ department: RegisteredDepartment; coordinator: DepartmentCoordinator }> {
    return Array.from(this.entries.values())
      .filter(e => e.department.enabled)
      .map(e => ({ department: e.department, coordinator: e.coordinator }));
  }

  get(id: string): RegisteredDepartment | undefined {
    return this.entries.get(id)?.department;
  }

  isRegistered(id: string): boolean {
    return this.entries.has(id);
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.department.enabled = enabled;
    return true;
  }

  // ─── CEO Heartbeat integration ─────────────────────────────────────────────

  /**
   * Called by CEO Heartbeat's coordinateAgents() for the department loop.
   * Returns a summary of all department reviews for timeline logging.
   */
  async runAllHeartbeatReviews(orgId: string): Promise<{
    departmentsRun:     number;
    departmentsPassed:  number;
    totalChecks:        number;
    totalAlerts:        number;
    results:            HeartbeatReviewResult[];
    errors:             string[];
  }> {
    const enabled = this.getEnabledDepartments();
    const results: HeartbeatReviewResult[] = [];
    const errors: string[] = [];
    let totalChecks = 0;
    let totalAlerts = 0;
    let passed = 0;

    for (const { department, coordinator } of enabled) {
      try {
        const result = await coordinator.runHeartbeatReview(orgId);
        results.push(result);
        totalChecks += result.checksRun;
        totalAlerts += result.alertsCreated;
        if (!result.error) passed++;
      } catch (err: any) {
        const errResult: HeartbeatReviewResult = {
          departmentId:     department.id,
          departmentName:   department.name,
          checksRun:        0,
          checksPassed:     0,
          alertsCreated:    0,
          bestAction:       null,
          executiveSummary: "",
          healthChecks:     [],
          error:            err.message,
        };
        results.push(errResult);
        errors.push(`${department.id}: ${err.message}`);
      }

      // Update last reviewed timestamp
      const entry = this.entries.get(department.id);
      if (entry) entry.department.lastReviewedAt = new Date();
    }

    return {
      departmentsRun:    enabled.length,
      departmentsPassed: passed,
      totalChecks,
      totalAlerts,
      results,
      errors,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const departmentRegistry = new DepartmentRegistry();

// ─── Auto-registration of Opportunity Acquisition (Department #1) ──────────────
// Imported lazily to avoid circular deps. Registration happens once at module
// load time so it is ready before the first heartbeat cycle.

import("./opportunity-executive-coordinator")
  .then(({ opportunityDepartmentCoordinator }) => {
    departmentRegistry.register(opportunityDepartmentCoordinator, {
      name:                  "Opportunity Acquisition",
      description:           "Discovers, qualifies, and converts new business opportunities through AI-assisted outreach, reply intelligence, and executive recommendations.",
      version:               "11.0.0",
      enabled:               true,
      discoveryEnabled:      true,
      qualificationEnabled:  true,
      outreachEnabled:       true,
      executionEnabled:      true,
      learningEnabled:       true,
      executiveEnabled:      true,
    });
  })
  .catch((err: any) => {
    console.warn("[DepartmentRegistry] Could not register Opportunity Acquisition:", err.message);
  });

// ─── Auto-registration of Hiring (Department #2) ──────────────────────────────

import("./hiring-department-coordinator")
  .then(({ hiringDepartmentCoordinator }) => {
    departmentRegistry.register(hiringDepartmentCoordinator, {
      name:                  "Hiring Department",
      description:           "Manages the full candidate lifecycle from discovery to hire. Includes AI assessment, outreach drafts, pipeline management, learning, and executive intelligence.",
      version:               "1.0.0",
      enabled:               true,
      discoveryEnabled:      true,
      qualificationEnabled:  true,
      outreachEnabled:       true,
      executionEnabled:      true,
      learningEnabled:       true,
      executiveEnabled:      true,
    });
  })
  .catch((err: any) => {
    console.warn("[DepartmentRegistry] Could not register Hiring Department:", err.message);
  });
