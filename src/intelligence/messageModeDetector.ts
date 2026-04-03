import type { ActiveSession } from "../memoryStore.js";
import type { DraftMode } from "../memoryStore.js";
import type { Confidence } from "./types.js";

export type ModeClassification = {
  mode: DraftMode;
  confidence: Confidence;
};

export function detectMessageMode(
  text: string,
  session?: ActiveSession | null,
): ModeClassification {
  const lower = text.toLowerCase();

  if (/\b(thank you|thanks for|thanks so|appreciate (?:you|it)|grateful)\b/.test(lower)) {
    return { mode: "thank_you", confidence: "high" };
  }
  if (/\b(sorry|apologize|my fault|i messed up|shouldn't have|feel bad about)\b/.test(lower)) {
    return { mode: "apology", confidence: "high" };
  }
  if (
    /\b(schedule|calendar|meet(?:ing)?|zoom|teams call|when are you free|availability|book a time|slot|free (?:on|this|next)|\b\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.test(
      lower,
    )
  ) {
    return { mode: "scheduling", confidence: "high" };
  }
  if (
    /\b(invite|party|get together|you free (?:for|on)|join us|come over|reception|dinner at)\b/.test(
      lower,
    )
  ) {
    return { mode: "invitation", confidence: "high" };
  }
  if (
    /\b(network|coffee chat|informational|pick your brain|connect on linkedin|reach out professionally)\b/.test(
      lower,
    )
  ) {
    return { mode: "networking", confidence: "high" };
  }
  if (
    /\b(follow(?:\s*[- ]?up)?|checking in|circling back|any updates|heard back|status on)\b/.test(
      lower,
    )
  ) {
    return { mode: "follow_up", confidence: "high" };
  }

  if (session?.mode && session.mode !== "general") {
    if (/\b(different topic|not a thank you|not an apology|actually scheduling)\b/i.test(lower)) {
      return { mode: "general", confidence: "low" };
    }
    return { mode: session.mode, confidence: "low" };
  }

  return { mode: "general", confidence: "low" };
}
