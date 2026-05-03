export interface ContactQuality {
  score: number;
  reason: string;
  tier: "high" | "medium" | "low" | "missing";
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

function detectEmailTier(email: string, contactRole: string): "direct_coach" | "athletic_director" | "athletics_dept" | "generic" | "invalid" {
  const e = email.toLowerCase().trim();
  const role = (contactRole || "").toLowerCase();

  if (!isValidEmail(e)) return "invalid";

  const coachRoles = ["head coach", "coach", "assistant coach", "director of strength", "strength coach", "trainer"];
  const adRoles = ["athletic director", "athletics director", "ad", "director of athletics"];

  if (coachRoles.some((r) => role.includes(r))) return "direct_coach";
  if (adRoles.some((r) => role.includes(r))) return "athletic_director";

  const emailParts = e.split("@")[0];

  if (
    emailParts.includes("coach") ||
    emailParts.includes("trainer") ||
    emailParts.includes("strength")
  ) return "direct_coach";

  if (
    emailParts.includes("ad") ||
    emailParts.includes("athletics") && !emailParts.includes("dept") ||
    emailParts.includes("athleticdirector") ||
    emailParts.includes("director")
  ) return "athletic_director";

  if (
    emailParts.includes("athletics") ||
    emailParts.includes("sports") ||
    emailParts.includes("athletic") ||
    e.includes("athletics@") ||
    e.includes("sports@")
  ) return "athletics_dept";

  if (
    emailParts === "info" ||
    emailParts === "office" ||
    emailParts === "admin" ||
    emailParts === "contact" ||
    emailParts === "hello" ||
    emailParts === "general" ||
    emailParts === "school" ||
    emailParts === "main" ||
    emailParts.startsWith("info") ||
    emailParts.startsWith("office")
  ) return "generic";

  return "athletics_dept";
}

export function computeContactQualityScore(prospect: {
  contactEmail?: string | null;
  contactRole?: string | null;
}): ContactQuality {
  const email = prospect.contactEmail?.trim() ?? "";
  const role = prospect.contactRole ?? "";

  if (!email) {
    return {
      score: 0,
      reason: "No email address on file",
      tier: "missing",
    };
  }

  if (!isValidEmail(email)) {
    return {
      score: 0,
      reason: "Email address appears invalid",
      tier: "missing",
    };
  }

  const tier = detectEmailTier(email, role);

  switch (tier) {
    case "direct_coach":
      return {
        score: 92,
        reason: "Direct coach email — highest deliverability and relevance",
        tier: "high",
      };
    case "athletic_director":
      return {
        score: 80,
        reason: "Athletic director email — decision maker with budget authority",
        tier: "high",
      };
    case "athletics_dept":
      return {
        score: 62,
        reason: "School athletics department email — likely reaches right team, may be filtered",
        tier: "medium",
      };
    case "generic":
      return {
        score: 38,
        reason: "Generic school or organization inbox — may not reach decision maker",
        tier: "low",
      };
    default:
      return {
        score: 0,
        reason: "Email address is invalid or undeliverable",
        tier: "missing",
      };
  }
}

export function contactQualityBadgeClass(tier: ContactQuality["tier"]): string {
  return {
    high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    medium: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    low: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    missing: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  }[tier];
}

export function contactQualityLabel(tier: ContactQuality["tier"]): string {
  return {
    high: "High Quality",
    medium: "Medium Quality",
    low: "Low Quality",
    missing: "No Email",
  }[tier];
}
