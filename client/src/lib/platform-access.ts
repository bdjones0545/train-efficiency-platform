export const PLATFORM_ADMIN_ORG_NAME = "Efficiency Strength Training";

export function isPlatformAdminOrg(orgName?: string | null): boolean {
  return orgName === PLATFORM_ADMIN_ORG_NAME;
}
