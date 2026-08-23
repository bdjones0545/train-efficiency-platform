import { getIntegration } from "../integration-runtime";

export interface KevinSlackTarget {
  integrationId: string;
  orgId: string;
  teamId: string;
  channel: string;
  botToken: string;
}

export async function getKevinSlackTargetForOrganization(orgId: string): Promise<KevinSlackTarget | null> {
  const integration = await getIntegration(orgId, "slack");
  if (!integration || integration.status !== "connected") return null;

  const credentials = (integration.encryptedCredentials ?? {}) as Record<string, unknown>;
  const teamId = String(credentials.teamId ?? credentials.slackTeamId ?? "").trim();
  const channel = String(credentials.defaultChannel ?? "").trim();
  const botToken = String(credentials.botToken ?? "").trim();
  if (!teamId || !channel || !botToken) return null;

  return { integrationId: integration.id, orgId, teamId, channel, botToken };
}
