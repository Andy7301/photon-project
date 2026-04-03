import type { DraftRecord } from "./memoryStore.js";
import type { RecipientHint } from "./memoryStore.js";

const ORDINAL = [
  /\b(first|1st)\b/i,
  /\b(second|2nd)\b/i,
  /\b(third|3rd)\b/i,
  /\b(fourth|4th)\b/i,
  /\b(fifth|5th)\b/i,
];

const HINT_WORDS: { re: RegExp; hint: RecipientHint }[] = [
  { re: /\brecruiter|hiring|interview\b/i, hint: "recruiter" },
  { re: /\bprofessor|prof\b/i, hint: "professor" },
  { re: /\bfriend\b/i, hint: "friend" },
  { re: /\bgroup\b/i, hint: "group" },
];

/**
 * Resolve which draft the user means (heuristic). Returns draft id or null.
 */
export function resolveDraftReference(
  text: string,
  drafts: DraftRecord[],
  activeDraftId: string | null | undefined,
): string | null {
  if (!drafts.length) return null;
  const lower = text.toLowerCase();

  if (/\b(that one|this one|the current (?:one)?|active draft|this draft)\b/i.test(lower)) {
    return activeDraftId ?? drafts[drafts.length - 1]?.id ?? null;
  }

  for (let i = 0; i < ORDINAL.length; i++) {
    if (ORDINAL[i].test(lower) && drafts[i]) return drafts[i].id;
  }

  const n = text.match(/\b(?:draft|#)\s*(\d)\b/i);
  if (n) {
    const idx = Number.parseInt(n[1], 10) - 1;
    if (idx >= 0 && idx < drafts.length) return drafts[idx].id;
  }

  for (const { re, hint } of HINT_WORDS) {
    if (!re.test(lower)) continue;
    const match = drafts.filter((d) => d.recipientHint === hint);
    if (match.length === 1) return match[0].id;
    const titled = match.find((d) => d.title && re.test(d.title));
    if (titled) return titled.id;
  }

  for (const d of drafts) {
    if (d.title && lower.includes(d.title.toLowerCase())) return d.id;
  }

  return null;
}
