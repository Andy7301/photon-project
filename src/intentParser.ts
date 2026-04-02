export type IntentType = "draft" | "rewrite" | "reminder" | "unknown";

export type Intent =
  | {
      type: "draft";
      hints: string[];
    }
  | {
      type: "rewrite";
      hints: string[];
      /** Text to rewrite when not inferred from memory */
      previousUserText?: string;
    }
  | {
      type: "reminder";
      hints: string[];
    }
  | {
      type: "unknown";
      hints: string[];
    };

const REMINDER_RE = /\bremind\s+me\b/i;
const REWRITE_RE =
  /\b(shorter|warmer|more\s+confident|rewrite|rephrase|polish|tighten|make\s+this)\b/i;

export function parseIntent(text: string | null): Intent {
  const t = (text ?? "").trim();
  if (!t) {
    return { type: "unknown", hints: ["empty"] };
  }

  const hints: string[] = [];

  if (REMINDER_RE.test(t)) {
    hints.push("reminder");
    return { type: "reminder", hints };
  }

  if (REWRITE_RE.test(t)) {
    hints.push("rewrite");
    return { type: "rewrite", hints };
  }

  return { type: "draft", hints };
}
