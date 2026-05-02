import OpenAI from "openai";

const openai = new OpenAI();

export type ReplyClassification =
  | "interested"
  | "not_interested"
  | "ask_info"
  | "referral"
  | "wrong_contact"
  | "out_of_office"
  | "unknown";

const CLASSIFICATION_DESCRIPTIONS: Record<ReplyClassification, string> = {
  interested: "Shows genuine interest in training services",
  not_interested: "Declines or is not interested",
  ask_info: "Asking for more information or details",
  referral: "Referring to someone else or another contact",
  wrong_contact: "Not the right person or organization",
  out_of_office: "Auto-reply or out of office message",
  unknown: "Cannot clearly determine intent",
};

export async function classifyReply(replyText: string): Promise<ReplyClassification> {
  if (!replyText?.trim()) return "unknown";

  const trimmed = replyText.trim().slice(0, 2000);

  // Quick heuristic for out of office
  const oooKeywords = ["out of office", "out of the office", "on vacation", "auto-reply", "automatic reply", "be back", "returning on"];
  if (oooKeywords.some(kw => trimmed.toLowerCase().includes(kw))) {
    return "out_of_office";
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are classifying a reply to an outreach email from a sports training facility. 
Classify the reply into exactly one of these categories:
- interested: genuine interest in training services
- not_interested: declines or not interested
- ask_info: asking for more details or information
- referral: redirecting to another person
- wrong_contact: wrong person or organization
- out_of_office: auto-reply / OOO
- unknown: unclear intent

Respond with only the category name, nothing else.`,
        },
        { role: "user", content: trimmed },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const raw = response.choices[0]?.message?.content?.trim().toLowerCase() ?? "";
    const valid: ReplyClassification[] = [
      "interested", "not_interested", "ask_info", "referral",
      "wrong_contact", "out_of_office", "unknown",
    ];
    return valid.includes(raw as ReplyClassification) ? (raw as ReplyClassification) : "unknown";
  } catch (err) {
    console.error("[ReplyClassifier] OpenAI error:", err);
    return "unknown";
  }
}

export function classificationLabel(c: ReplyClassification | null | undefined): string {
  if (!c) return "—";
  return {
    interested: "Interested",
    not_interested: "Not Interested",
    ask_info: "Asking Info",
    referral: "Referral",
    wrong_contact: "Wrong Contact",
    out_of_office: "Out of Office",
    unknown: "Unknown",
  }[c] ?? c;
}

export function classificationColor(c: ReplyClassification | null | undefined): string {
  return {
    interested: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    not_interested: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    ask_info: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    referral: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    wrong_contact: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    out_of_office: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    unknown: "bg-muted text-muted-foreground",
  }[c ?? "unknown"] ?? "bg-muted text-muted-foreground";
}
