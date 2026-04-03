const REPLY_PHRASES =
  /\b(?:how should i (?:reply|respond)|write (?:a |the )?reply|respond to this|answer (?:this|them)|what should i say|draft (?:a )?response|give me (?:\d+\s+)?options?.*(?:casual|professional|confident))\b/i;

const THEY_SAID = /(?:^|\n)(?:they|she|he) said:?\s*(.+?)(?=\n\n|\n[A-Z]|$)/ims;
const QUOTED =
  /["\u201c]([^\u201d"]{8,2000})["\u201d]/s;
const BLOCK_AFTER_NEWLINE = /\n\s*["\u201c']([^\n\u201d']{8,2000})["\u201d']/;

export type ReplyDetection = {
  isReplyRequest: boolean;
  extractedQuote?: string;
};

/**
 * Detect reply-help requests and extract a quoted incoming message when present.
 */
export function detectReplyIntent(text: string): ReplyDetection {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  let extracted: string | undefined;

  const they = trimmed.match(THEY_SAID);
  if (they?.[1]) extracted = they[1].trim();

  if (!extracted) {
    const q = trimmed.match(QUOTED);
    if (q?.[1]) extracted = q[1].trim();
  }
  if (!extracted) {
    const b = trimmed.match(BLOCK_AFTER_NEWLINE);
    if (b?.[1]) extracted = b[1].trim();
  }

  const phraseHit = REPLY_PHRASES.test(lower);
  const withReplyKeywords =
    Boolean(extracted) && /\b(reply|respond|answer|what (?:do )?i say|draft|respond to)\b/i.test(lower);

  return {
    isReplyRequest: phraseHit || withReplyKeywords,
    extractedQuote: extracted,
  };
}
