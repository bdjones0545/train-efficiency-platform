export class ComposioSpecializedAuthorityError extends Error {
  constructor() {
    super("Specialized Composio approval is stale or unavailable");
    this.name = "ComposioSpecializedAuthorityError";
  }
}

export function assertSpecializedExecutionAuthority(input: {
  currentVersion: unknown;
  approvedVersion: unknown;
  approvedConnectedAccountId: unknown;
  resolvedConnectedAccountId: string;
  executionClaimed: boolean;
  alreadySucceeded?: boolean;
}): void {
  const current = Number(input.currentVersion);
  const approved = Number(input.approvedVersion);
  if (!Number.isSafeInteger(current) || current < 1 || approved !== current ||
      !input.executionClaimed || input.alreadySucceeded ||
      typeof input.approvedConnectedAccountId !== "string" ||
      input.approvedConnectedAccountId !== input.resolvedConnectedAccountId) {
    throw new ComposioSpecializedAuthorityError();
  }
}
