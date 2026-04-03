import type { UserProfile } from "../memoryStore.js";

/**
 * Optional extra instruction line from explicit tone words in the user message or profile.
 */
export function toneInstructionLine(
  userText: string,
  profile?: UserProfile,
): string | undefined {
  const lower = userText.toLowerCase();
  const bits: string[] = [];

  if (/\b(?:more\s+)?(?:warm|warmer|friendly|polite)\b/.test(lower)) {
    bits.push("Favor a warm, friendly register.");
  }
  if (/\b(?:more\s+)?direct\b/.test(lower) && !/\bindirect\b/.test(lower)) {
    bits.push("Be direct and clear; skip soft filler.");
  }
  if (/\b(?:more\s+)?polished\b/.test(lower)) {
    bits.push("Polished and composed—still a text, not an essay.");
  }
  if (/\b(?:more\s+)?casual\b/.test(lower)) {
    bits.push("Casual and natural; contractions OK.");
  }
  if (/\b(?:more\s+)?confident\b/.test(lower)) {
    bits.push("Confident and assured without sounding arrogant.");
  }

  if (bits.length) return bits.join(" ");

  const p = profile?.tone?.toLowerCase();
  if (p) {
    if (/\b(warm|friendly)\b/.test(p)) return "Default lean: warm and natural.";
    if (/\b(direct|concise)\b/.test(p)) return "Default lean: direct and brief.";
    if (/\b(casual)\b/.test(p)) return "Default lean: casual.";
    if (/\b(polished|formal)\b/.test(p)) return "Default lean: polished.";
    if (/\b(confident)\b/.test(p)) return "Default lean: confident.";
  }

  return undefined;
}
