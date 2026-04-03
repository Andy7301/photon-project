import type { ActiveSession, DraftRecord, UserProfile } from "./memoryStore.js";
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
      wantMultipleOptions: boolean;
    }
  | {
      kind: "iterate";
      op: "rewrite";
      rewriteScope: "all" | "single";
      selection: number[];
      constraints: string[];
      wantMultipleOptions: boolean;
    }
  | {
      kind: "iterate";
      op: "combine";
      selection: [number, number];
      constraints: string[];
      wantMultipleOptions: boolean;
    }
  | {
      kind: "reminder";
      constraints: string[];
      linkToDraft: boolean;
      wantMultipleOptions: boolean;
    }
  | {
      kind: "clarify";
      message: string;
      wantMultipleOptions: false;
    }
  | {
      kind: "lifecycle";
      action: "finalize" | "pending_send" | "mark_sent" | "abandon";
    }
  | { kind: "list_drafts" }
  | { kind: "delete_draft"; targetHint?: string }
  | { kind: "switch_draft"; targetHint?: string }
  | {
      kind: "nudge_prefs";
      action: "snooze" | "opt_out" | "resume";
      hours?: number;
    }
  | { kind: "copy_send"; action: "copy" | "send_this" };

/** Exported for handler: when prior turn has one draft, user can still ask for three alternatives. */
export function wantsExplicitAlternatives(text: string): boolean {
  // Trigger on "options/alternatives/choices/variants" wording.
  // Intentionally does not match "option 2" (singular) used for iteration.
  const lower = text.toLowerCase();
  const hasChoiceWord = /\b(options|alternatives|choices|variants)\b/.test(lower);
  const hasShowOrGive = /\b(show|give|display)\b/.test(lower);
  const hasMore = /\bmore\b/.test(lower);
  const hasThree = /\b(3|three)\b/.test(lower);
  if (!hasChoiceWord) return false;
  return hasShowOrGive || hasMore || hasThree;
}

function parseOrdinalIndices(text: string): number[] | null {
  const combine = text.match(COMBINE_RE);
  if (combine) {
    const a = Number.parseInt(combine[1], 10) - 1;
    const b = Number.parseInt(combine[2], 10) - 1;
    if (a >= 0 && a <= 2 && b >= 0 && b <= 2) return [a, b];
  }

  const scopedEdit = text.match(
    /\b(shorter|warmer|casual|snappier|tighten|condense)\s+(?:#|option\s*)?(\d)\b/i,
  );
  if (scopedEdit) {
    const n = Number.parseInt(scopedEdit[2], 10);
    if (n >= 1 && n <= 3) return [n - 1];
  }
  const revEdit = text.match(/\b(\d)\s+(shorter|warmer|casual|snappier)\b/i);
  if (revEdit) {
    const n = Number.parseInt(revEdit[1], 10);
    if (n >= 1 && n <= 3) return [n - 1];
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

export function resolveIntent(
  text: string,
  ctx: {
    session: ActiveSession | null | undefined;
    profile?: UserProfile;
    drafts?: DraftRecord[];
    activeDraftId?: string | null;
  },
): ResolvedIntent {
  const t = text.trim();
  if (!t) {
    return {
      kind: "clarify",
      message: "Send a message to draft or refine.",
      wantMultipleOptions: false,
    };
  }

  const lower = t.toLowerCase();

  if (/\b(show|list)\s+(?:my\s+)?drafts\b/i.test(t)) {
    return { kind: "list_drafts" };
  }

  if (/\b(delete|remove)\s+(?:the\s+)?draft\b/i.test(t) || /\bdelete\s+this\s+draft\b/i.test(t)) {
    return { kind: "delete_draft", targetHint: t };
  }

  if (
    /\b(switch\s+to|resume|open|use)\s+(?:the\s+)?draft\b/i.test(t) ||
    /\bgo\s+back\s+to\s+(?:the\s+)?/i.test(t)
  ) {
    return { kind: "switch_draft", targetHint: t };
  }

  if (/\bstop\s+nudg/i.test(t) || /\bopt\s*out\s+of\s+nudg/i.test(t)) {
    return { kind: "nudge_prefs", action: "opt_out" };
  }
  if (/\bresume\s+nudg/i.test(t) || /\bstart\s+nudg/i.test(t)) {
    return { kind: "nudge_prefs", action: "resume" };
  }
  const snooze = lower.match(/\bsnooze\s+(?:nudges?\s+)?(?:for\s+)?(\d+)\s*(h|hr|hrs|hour|hours)?/i);
  if (/\bsnooze\b/i.test(t) && /\bnudg/i.test(t)) {
    const h = snooze?.[1] ? Number.parseInt(snooze[1], 10) : 24;
    return { kind: "nudge_prefs", action: "snooze", hours: h };
  }

  if (/\bcopy\s+(?:this|final|the\s+draft|version)\b/i.test(t) || /\bpaste\s+(?:ready|version)\b/i.test(t)) {
    return { kind: "copy_send", action: "copy" };
  }
  if (/\bsend\s+this\b/i.test(t) || /\bready\s+to\s+send\b/i.test(t)) {
    return { kind: "copy_send", action: "send_this" };
  }

  if (
    /\b(mark\s+as\s+)?final(ize)?\b/i.test(t) ||
    /\bfinal\s+version\b/i.test(t) ||
    /\bthis\s+is\s+(?:the\s+)?final\b/i.test(t)
  ) {
    return { kind: "lifecycle", action: "finalize" };
  }
  if (/\bsend\s+(?:it\s+)?later\b/i.test(t) || /\bqueue\s+(?:for\s+)?send/i.test(t)) {
    return { kind: "lifecycle", action: "pending_send" };
  }
  if (/\b(sent\s+it|i\s+sent|already\s+sent|mark\s+(?:as\s+)?sent)\b/i.test(t)) {
    return { kind: "lifecycle", action: "mark_sent" };
  }
  if (/\b(forget\s+(?:this|that|it)|abandon|discard)\b/i.test(t)) {
    return { kind: "lifecycle", action: "abandon" };
  }

  const hasSession = Boolean(ctx.session?.turns?.length);
  const variants = getLatestVariants(ctx.session ?? null);
  const explicitMulti = wantsExplicitAlternatives(t);

  if (REMINDER_RE.test(t)) {
    const linkToDraft =
      /\b(this|that|it|send)\b/i.test(t) && variants.length > 0;
    return {
      kind: "reminder",
      constraints: [],
      linkToDraft,
      wantMultipleOptions: explicitMulti,
    };
  }

  const ordinals = parseOrdinalIndices(t);
  const wantsIterateWords = ITERATE_WORDS.test(t);
  const combineMatch = t.match(COMBINE_RE);

  if (combineMatch && !hasSession) {
    return {
      kind: "clarify",
      message:
        "I need an active draft first. Ask for a draft, then say something like “combine 1 and 2”.",
      wantMultipleOptions: false,
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
      wantMultipleOptions: explicitMulti,
    };
  }

  if (hasSession && ordinals && ordinals.length === 2) {
    return {
      kind: "iterate",
      op: "combine",
      selection: [ordinals[0], ordinals[1]],
      constraints: [t],
      wantMultipleOptions: explicitMulti,
    };
  }

  // Unscoped edit words: match # of outputs to # of variants in last turn (1–3); explicit “3 alternatives” can force 3 when only one prior exists.
  if (hasSession && wantsIterateWords && ordinals === null) {
    const priorN = Math.min(3, variants.length);
    const multiDisplay = explicitMulti ? true : priorN > 1;
    return {
      kind: "iterate",
      op: "rewrite",
      rewriteScope: "all",
      selection: [],
      constraints: [t],
      wantMultipleOptions: multiDisplay,
    };
  }

  // Scoped to one option: "shorter 2", "second", "option 3", "#1 warmer", etc.
  if (hasSession && ordinals && ordinals.length === 1) {
    return {
      kind: "iterate",
      op: "rewrite",
      rewriteScope: "single",
      selection: ordinals,
      constraints: wantsIterateWords
        ? [t]
        : ["Adjust tone/length to match what I asked before.", t],
      wantMultipleOptions: explicitMulti,
    };
  }

  if (!hasSession && (wantsIterateWords || (ordinals && !REMINDER_RE.test(t)))) {
    return {
      kind: "clarify",
      message:
        "I don’t have an active draft yet. Send what you want to say (e.g. follow up with a recruiter), then you can say “shorter” or “option 2”.",
      wantMultipleOptions: false,
    };
  }

  return { kind: "new_draft", constraints: [t], wantMultipleOptions: true };
}
