export type RequiredFeatureSchemaReadiness = "not_started" | "initializing" | "ready" | "failed";

let state: RequiredFeatureSchemaReadiness = "not_started";
let error: string | null = null;
let subsystems: Record<string, "pending" | "ready" | "failed"> = {};

export function beginRequiredFeatureSchemaInitialization(names: string[]): void {
  state = "initializing";
  error = null;
  subsystems = Object.fromEntries(names.map((name) => [name, "pending"]));
}

export function markRequiredFeatureSubsystem(name: string, result: "ready" | "failed"): void {
  subsystems[name] = result;
}

export function completeRequiredFeatureSchemaInitialization(): void {
  state = "ready";
  error = null;
}

export function failRequiredFeatureSchemaInitialization(cause: unknown): void {
  state = "failed";
  error = cause instanceof Error ? cause.message : String(cause);
}

export function isRequiredFeatureSchemaReady(): boolean {
  return state === "ready";
}

export function getRequiredFeatureSchemaReadiness() {
  return { state, error, subsystems: { ...subsystems } } as const;
}
