import type { ActiveSession, UserProfile } from "./memoryStore.js";
import { getLatestVariants } from "./draftSession.js";

const REMINDER_RE = /\bremind\s+me\b/i;

const ITERATE_WORDS =
  /\b(shorter|warmer|more\s+casual|more\s+confident|rewrite|rephrase|polish|tighten|make\s+it|make\s+this|condense|snappier)\b/i;

const COMBINE_RE = /\bcombine\s+(?:option\s*)?(?:#)?(\d)\s*(?:and|&|\+)\s*(?:option\s*)?(?:#)?(\d)\b/i;

const VERSION_RE = /\bversion\s*(\d)\b|(?:^|\s)#(\d)(?:\s|$)/i;

export type ResolvedIntent =
  | {
      kind: "new_draft";
      constraints: string[];
    }
  | {
      kind: "iterate";
      op: "rewrite" | "combine";
      selection: number[];
      constraints: string[];
    }
  | {
      kind: "reminder";
      constraints: string[];
      linkToDraft: boolean;
    }
  | {
      kind: "clarify";
      message: string;
    };

function parseOrdinalIndices(text: string): number[] | null {
  const combine = text.match(COMBINE_RE);
  if (combine) {
    const a = Number.parseInt(combine[1], 10) - 1;
    const b = Number.parseInt(combine[2], 10) - 1;
    if (a >= 0 && a <= 2 && b >= 0 && b <= 2) return [a, b];
  }

  const vm = text.match(VERSION_RE);
  if (vm) {
    const n = Number.parseInt(vm[1] ?? vm[2], 10);
    if (n >= 1 && n <= 3) return [n - 1];
  }

  const lower = text.toLowerCase();
  if (/\b(first|1st|#1|option\s*1|the\s+first)\b/i.test(lower)) return [0];
  if (/\b(second|2nd|#2|option\s*2|the\s+second)\b/i.test(lower)) return [1];
  if (/\b(third|3rd|#3|option\s*3|the\s+third)\b/i.test(lower)) return [2];

  const digit = text.match(/\b[Oo]ption\s*(\d)\b|\b#(\d)\b/);
  if (digit) {
    const n = Number.parseInt(digit[1] ?? digit[2], 10);
    if (n >= 1 && n <= 3) return [n - 1];
  }

  return null;
}

function defaultSelection(session: ActiveSession | null | undefined): number {
  if (session?.selectedVariantIndex !== undefined) return session.selectedVariantIndex;
  return 0;
}

export function resolveIntent(
  text: string,
  ctx: {
    session: ActiveSession | null | undefined;
    profile?: UserProfile;
  },
): ResolvedIntent {
  const t = text.trim();
  if (!t) {
    return { kind: "clarify", message: "Send a message to draft or refine." };
  }

  const hasSession = Boolean(ctx.session?.turns?.length);
  const variants = getLatestVariants(ctx.session ?? null);

  if (REMINDER_RE.test(t)) {
    const linkToDraft =
      /\b(this|that|it|send)\b/i.test(t) && variants.length > 0;
    return { kind: "reminder", constraints: [], linkToDraft };
  }

  const ordinals = parseOrdinalIndices(t);
  const wantsIterateWords = ITERATE_WORDS.test(t);
  const combineMatch = t.match(COMBINE_RE);

  if (combineMatch && !hasSession) {
    return {
      kind: "clarify",
      message:
        "I need an active draft first. Ask for a draft, then say something like “combine 1 and 2”.",
    };
  }

  if (combineMatch && hasSession) {
    const a = Number.parseInt(combineMatch[1], 10) - 1;
    const b = Number.parseInt(combineMatch[2], 10) - 1;
    return {
      kind: "iterate",
      op: "combine",
      selection: [a, b],
      constraints: [t],
    };
  }

  if (hasSession && ordinals && ordinals.length === 2) {
    return {
      kind: "iterate",
      op: "combine",
      selection: ordinals,
      constraints: [t],
    };
  }

  if (hasSession && (wantsIterateWords || ordinals !== null)) {
    if (ordinals && ordinals.length === 1 && wantsIterateWords) {
      return {
        kind: "iterate",
        op: "rewrite",
        selection: ordinals,
        constraints: [t],
      };
    }
    if (ordinals && ordinals.length === 1 && !wantsIterateWords) {
      return {
        kind: "iterate",
        op: "rewrite",
        selection: ordinals,
        constraints: ["Adjust tone/length to match what I asked before.", t],
      };
    }
    if (wantsIterateWords) {
      return {
        kind: "iterate",
        op: "rewrite",
        selection: [defaultSelection(ctx.session ?? undefined)],
        constraints: [t],
      };
    }
  }

  if (!hasSession && (wantsIterateWords || (ordinals && !REMINDER_RE.test(t)))) {
    return {
      kind: "clarify",
      message:
        "I don’t have an active draft yet. Send what you want to say (e.g. follow up with a recruiter), then you can say “shorter” or “option 2”.",
    };
  }

  return { kind: "new_draft", constraints: [t] };
}
