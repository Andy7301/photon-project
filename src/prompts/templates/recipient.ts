import type { RecipientHint } from "../../memoryStore.js";

/** Richer than one-line hints in modes.ts — injected as system addendum. */
export const RECIPIENT_TEMPLATES: Record<RecipientHint, string> = {
  recruiter: `Audience: hiring / recruiter / interview context. Tone: professional, clear, respectful. Avoid slang unless the user asked. No desperate or pushy language.`,
  friend: `Audience: friend. Tone: natural and warm, like texting someone you know—contractions OK, not stiff.`,
  professor: `Audience: professor / academic. Tone: polite, concise, respectful formality. No overly casual slang.`,
  group: `Audience: group chat. Tone: inclusive, short, works when multiple people read it; avoid inside jokes unless the user included them.`,
  unknown: "",
};
