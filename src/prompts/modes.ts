import type { DraftMode, RecipientHint } from "../memoryStore.js";

const RECIPIENT_LINES: Record<RecipientHint, string> = {
  recruiter:
    "Recipient: hiring / recruiter — professional, clear, respectful; no slang unless user asked.",
  friend:
    "Recipient: friend — natural, warm, like texting someone you know well.",
  professor:
    "Recipient: professor / academic — polite, concise, respectful formality.",
  group:
    "Recipient: group chat — inclusive, short, works for multiple people.",
  unknown: "",
};

const MODE_LINES: Record<DraftMode, string> = {
  follow_up:
    "Message type: follow-up — reference prior context briefly; clear ask or next step.",
  thank_you: "Message type: thank-you — grateful, brief, specific if possible.",
  apology: "Message type: apology — accountable, concise, no over-explaining.",
  scheduling:
    "Message type: scheduling — concrete times/options, easy to reply yes/no.",
  invitation:
    "Message type: invitation — clear what/when; easy to accept or suggest an alternative.",
  networking:
    "Message type: networking — professional warmth; specific hook; not cold or salesy.",
  general: "",
};

export function recipientHintLine(hint: RecipientHint | undefined): string {
  if (!hint || hint === "unknown") return "";
  return RECIPIENT_LINES[hint];
}

export function modeLine(mode: DraftMode | undefined): string {
  if (!mode || mode === "general") return "";
  return MODE_LINES[mode];
}
