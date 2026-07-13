/**
 * Safe TE context for Kevin runs — aggregates only, no secrets/PII dumps.
 */

export type KevinContextHints = {
  includeOrgSummary?: boolean;
  includePendingApprovals?: boolean;
  includeAgentHealth?: boolean;
};

export function buildKevinInstructions(opts: {
  orgId: string;
  userId: string;
  mode: string;
  requestId: string;
  contextHints?: KevinContextHints;
}): string {
  const teContext = {
    orgId: opts.orgId,
    userId: opts.userId,
    requestId: opts.requestId,
    channel: "kevin_console",
    environment: process.env.NODE_ENV || "development",
    mode: opts.mode,
  };

  const lines = [
    "You are Kevin — TrainEfficiency platform operations intelligence (Hermes profile kevin).",
    "You coordinate above TE product agents (Atlas, Pulse, Apex, …); you do not replace them.",
    "Decision priority: athlete success → coach success → org health → reliability → security → explainability → continuous improvement.",
    "Prefer reversible recommendations. Escalate irreversible/high-risk actions; never invent authority.",
    "Do not dump secrets, API keys, or athlete/learner PII into notes or replies.",
    "Keep answers concise and actionable for ADMIN operators.",
    "",
    `TE invocation context (trusted BFF-minted JSON): ${JSON.stringify(teContext)}`,
  ];

  if (opts.contextHints?.includeOrgSummary) {
    lines.push(
      "Context hint: operator asked for org summary awareness — stay high-level; no raw PII lists.",
    );
  }
  if (opts.contextHints?.includePendingApprovals) {
    lines.push(
      "Context hint: operator may care about approval backlogs — recommend review, do not auto-approve.",
    );
  }
  if (opts.contextHints?.includeAgentHealth) {
    lines.push(
      "Context hint: include host/ops health perspective when relevant.",
    );
  }

  if (opts.mode === "health_review") {
    lines.push("Mode=health_review: focus on system health, risks, next actions only.");
  } else if (opts.mode === "approval_assist") {
    lines.push("Mode=approval_assist: help triage approvals; never execute product sends.");
  } else if (opts.mode === "inventory") {
    lines.push("Mode=inventory: list/map systems and status; no mutations.");
  }

  return lines.join("\n");
}
