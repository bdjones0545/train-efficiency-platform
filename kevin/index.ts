/**
 * Kevin → TrainEfficiency Integration — Barrel Export
 *
 * Entry point for all Kevin TE integration modules.
 * Import from here for a clean public API surface.
 */

// Step 2: Access plane configuration
export {
  loadTeConfig, tryLoadTeConfig, getCredentialStatus,
  redactSensitiveHeader, redactHeaders,
  type TeConfig, type CredentialStatus,
} from "./config";

// Step 3: TE control-plane client
export {
  TrainEfficiencyClient, getTeClient, resetTeClient,
  generateNonce, generateTimestamp, generateIdempotencyKey,
  TERMINAL_INTENT_STATES, TERMINAL_TASK_STATES, TERMINAL_APPROVAL_STATES,
  type TeRequestOptions, type TeResponse, type TeError,
  type IntentSubmitArgs, type IntentRecord, type TaskRecord,
  type ApprovalRecord, type CapabilityRecord,
  type IntentState, type TaskState, type ApprovalState,
} from "./te-client";

// Step 5–6: Operational model & capability map
export {
  buildOperationalModel, serializeOperationalModel,
  isCapabilityExecutable, getEffectiveMode,
  type OperationalModel, type CapabilityEntry, type AgentEntry,
} from "./operational-model";

export {
  fetchCapabilityMap, mapCapability, findCapabilityForObjective,
  getExecutableCapabilitiesForCategory, summarizeCapabilityMap,
  type MappedCapability,
} from "./capability-map";

// Step 7–8: Executive intent workflow
export {
  executeIntentWorkflow, resumeAfterApproval,
  type ExecutiveRequest, type WorkflowResult,
} from "./intent-workflow";

// Step 10: Structured responses (14 block types)
export {
  buildDirectAnswer, buildRecommendation, buildCapabilityUnavailable,
  buildActionAvailable, buildDraftCreated, buildApprovalRequired,
  buildTaskDelegated, buildTaskInProgress, buildTaskCompleted,
  buildNavigation, buildWarning, buildPolicyDenial,
  buildFailure, buildOutcomeReport, buildEmergencyWarning,
  intentToBlock, modeToBlock,
  type ActionBlock, type ActionBlockType, type BlockAction,
} from "./structured-responses";

// Step 14: Approval handling
export {
  pollApproval, verifyApprovalPayloadMatch,
  type ApprovalPollResult, type ApprovalHandlerOptions,
} from "./approval-handler";

// Step 15: Verification & outcome handling
export {
  pollIntentToCompletion, verifyAndRecordOutcome,
  type VerificationRecord,
} from "./verification-handler";

// Step 16: Emergency controls
export {
  detectEmergencyCondition, handleEmergency, isNonRetryable, isRetryable,
  type EmergencyCondition, type EmergencyResponse,
} from "./emergency-handler";

// Step 17: Observability
export {
  obsAuth, obsCapabilityDiscovery, obsIntentSubmit, obsIntentStateChange,
  obsTaskStateChange, obsApprovalStateChange, obsOutcomeRetrieved,
  obsRetry, obsPolicyDenial, obsVerificationFailed, obsEmergencyControl,
  obsRequestSent, obsRequestError,
  type ObsLevel, type ObsEvent,
} from "./observability";

// Step 4: Smoke tests
export { runSmokeTests, runSafeCapabilityTests, printSmokeReport } from "./smoke-tests";
