import type { DraftMode, RecipientHint, UserProfile } from "../memoryStore.js";
import type { MergedDraftContext } from "./mergeDraftContext.js";
import { APOLOGY_TEMPLATE } from "../prompts/templates/apology.js";
import { FOLLOW_UP_TEMPLATE } from "../prompts/templates/followUp.js";
import { INVITATION_TEMPLATE } from "../prompts/templates/invitation.js";
import { NETWORKING_TEMPLATE } from "../prompts/templates/networking.js";
import { RECIPIENT_TEMPLATES } from "../prompts/templates/recipient.js";
import { SCHEDULING_TEMPLATE } from "../prompts/templates/scheduling.js";
import { THANK_YOU_TEMPLATE } from "../prompts/templates/thankYou.js";
import { toneInstructionLine } from "./toneFromText.js";

const MODE_TEMPLATES: Record<DraftMode, string> = {
  follow_up: FOLLOW_UP_TEMPLATE,
  thank_you: THANK_YOU_TEMPLATE,
  apology: APOLOGY_TEMPLATE,
  scheduling: SCHEDULING_TEMPLATE,
  invitation: INVITATION_TEMPLATE,
  networking: NETWORKING_TEMPLATE,
  general: "",
};

export type PromptAddenda = {
  /** Concatenated into system instruction (after base rules). */
  systemAddendum: string;
  /** Inserted in user prompt (context blocks). */
  userAddendum: string;
};

export function selectPromptParts(input: {
  ctx: MergedDraftContext;
  profile?: UserProfile;
  userText: string;
}): PromptAddenda {
  const { ctx, profile, userText } = input;

  const recBlock = RECIPIENT_TEMPLATES[ctx.recipient] ?? "";
  const modeBlock = MODE_TEMPLATES[ctx.mode] ?? "";

  const toneLine = toneInstructionLine(userText, profile);
  const toneBlock = toneLine ? `Tone: ${toneLine}` : "";

  const systemParts = [recBlock, modeBlock, toneBlock].filter(Boolean);
  const systemAddendum = systemParts.join("\n\n");

  let userAddendum = "";
  if (ctx.replyQuote) {
    userAddendum = [
      "Incoming message to respond to (do not paste it back verbatim; write the user’s reply):",
      ctx.replyQuote,
      "Match or gently contrast the sender’s tone. Keep the reply sendable as a normal text.",
    ].join("\n");
  } else if (ctx.isReplyRequest && !ctx.replyQuote) {
    userAddendum =
      "The user wants help replying to someone. Infer the situation from their message; produce reply options that sound human.";
  }

  return { systemAddendum, userAddendum };
}
