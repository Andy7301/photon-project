import type { ActiveSession } from "../memoryStore.js";
import type { RecipientHint } from "../memoryStore.js";
import type { Confidence } from "./types.js";

const RECRUITER =
  /\b(recruiter|recruiting|hiring manager|interview|interviewer|job application|applied for|hiring|onboarding|offer|linkedin recruiter)\b/i;
const PROFESSOR =
  /\b(professor|prof\.|ta\b|teaching assistant|dean|faculty|academic advisor|office hours|course|class|syllabus|lecture)\b/i;
const GROUP =
  /\b(group chat|everyone|team chat|all of you|y'all|folks|group text|in the group)\b/i;
const FRIEND =
  /\b(friend|buddy|catch up|hang out|texting you|hey man|hey girl|dude|bff)\b/i;

/** Explicit: "to a recruiter", "for my professor" */
const EXPLICIT_TO =
  /\b(?:to|for|with)\s+(?:my\s+|a\s+|an\s+)?(recruiter|professor|prof|friend|interviewer)\b/i;

export type RecipientClassification = {
  recipient: RecipientHint;
  confidence: Confidence;
};

export function classifyRecipient(
  text: string,
  session?: ActiveSession | null,
): RecipientClassification {
  const t = text.trim();
  const lower = t.toLowerCase();

  const explicit = t.match(EXPLICIT_TO);
  if (explicit) {
    const g = (explicit[2] ?? explicit[3] ?? "").toLowerCase();
    if (g.includes("recruiter") || g.includes("interviewer"))
      return { recipient: "recruiter", confidence: "high" };
    if (g.includes("prof") || g.includes("professor"))
      return { recipient: "professor", confidence: "high" };
    if (g.includes("friend")) return { recipient: "friend", confidence: "high" };
  }

  if (RECRUITER.test(lower)) return { recipient: "recruiter", confidence: "high" };
  if (PROFESSOR.test(lower)) return { recipient: "professor", confidence: "high" };
  if (GROUP.test(lower)) return { recipient: "group", confidence: "high" };
  if (FRIEND.test(lower)) return { recipient: "friend", confidence: "high" };

  if (session?.recipientHint && session.recipientHint !== "unknown") {
    if (/\b(actually|instead|not the recruiter|wrong person|friend now)\b/i.test(lower)) {
      return { recipient: "unknown", confidence: "low" };
    }
    return { recipient: session.recipientHint, confidence: "low" };
  }

  return { recipient: "unknown", confidence: "low" };
}
