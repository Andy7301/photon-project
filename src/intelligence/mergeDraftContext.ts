import type { ActiveSession, UserMemory } from "../memoryStore.js";
import type { DraftMode, RecipientHint } from "../memoryStore.js";
import { classifyRecipient } from "./recipientClassifier.js";
import { detectMessageMode } from "./messageModeDetector.js";
import { detectReplyIntent } from "./replyDetector.js";
import type { Confidence } from "./types.js";

export type MergedDraftContext = {
  recipient: RecipientHint;
  mode: DraftMode;
  recipientConfidence: Confidence;
  modeConfidence: Confidence;
  replyQuote?: string;
  isReplyRequest: boolean;
};

function applySticky(
  classified: RecipientHint,
  conf: Confidence,
  sticky: RecipientHint | undefined,
): { recipient: RecipientHint; confidence: Confidence } {
  if (conf === "high") return { recipient: classified, confidence: conf };
  if (sticky && sticky !== "unknown") return { recipient: sticky, confidence: "low" };
  return { recipient: classified, confidence: conf };
}

function applyStickyMode(
  classified: DraftMode,
  conf: Confidence,
  sticky: DraftMode | undefined,
): { mode: DraftMode; confidence: Confidence } {
  if (conf === "high") return { mode: classified, confidence: conf };
  if (sticky && sticky !== "general") return { mode: sticky, confidence: "low" };
  return { mode: classified, confidence: conf };
}

/**
 * Merge heuristics with session sticky hints (before a fresh session clears them).
 */
export function mergeDraftContext(
  text: string,
  memory: UserMemory | undefined,
): MergedDraftContext {
  const session = memory?.session ?? undefined;
  const reply = detectReplyIntent(text);
  const rec = classifyRecipient(text, session);
  const mod = detectMessageMode(text, session);

  let recipient = rec.recipient;
  let recipientConfidence = rec.confidence;
  let mode = mod.mode;
  let modeConfidence = mod.confidence;

  const stickyRec = session?.recipientHint;
  const stickyMode = session?.mode;

  const r = applySticky(recipient, recipientConfidence, stickyRec);
  recipient = r.recipient;
  recipientConfidence = r.confidence;

  const m = applyStickyMode(mode, modeConfidence, stickyMode);
  mode = m.mode;
  modeConfidence = m.confidence;

  return {
    recipient,
    mode,
    recipientConfidence,
    modeConfidence,
    isReplyRequest: reply.isReplyRequest,
    replyQuote: reply.extractedQuote,
  };
}

export function shouldClarifyAudienceForNewDraft(
  ctx: MergedDraftContext,
  memory: UserMemory | undefined,
  text: string,
): boolean {
  if (ctx.isReplyRequest || ctx.replyQuote) return false;
  if (ctx.recipient !== "unknown" || ctx.mode !== "general") return false;
  if (memory?.session?.recipientHint && memory.session.recipientHint !== "unknown")
    return false;
  if (memory?.session?.mode && memory.session.mode !== "general") return false;
  if (text.trim().length < 15) return false;
  return true;
}
