import type { Intent } from "../intentParser.js";
import type { UserMemory } from "../memoryStore.js";

export function buildUserPrompt(params: {
  userText: string;
  intent: Intent;
  memory: UserMemory | undefined;
}): string {
  const { userText, intent, memory } = params;
  const lines: string[] = [];

  lines.push(`User message:\n${userText.trim()}`);

  if (intent.type === "rewrite" && intent.previousUserText) {
    lines.push(`\nText to rewrite:\n${intent.previousUserText}`);
  }

  lines.push(`\nDetected intent: ${intent.type}`);
  if (intent.hints.length) {
    lines.push(`Hints: ${intent.hints.join(", ")}`);
  }

  if (memory?.tonePreference) {
    lines.push(`\nUser tone preference (bias variants toward this when reasonable): ${memory.tonePreference}`);
  }
  if (memory?.recentDrafts?.length) {
    lines.push("\nRecent drafts from this user (for continuity, do not copy verbatim):");
    for (const d of memory.recentDrafts.slice(-3)) {
      lines.push(`- ${d}`);
    }
  }

  lines.push(
    "\nReturn JSON only per the system schema. If reminder is appropriate, include naturalLanguageTime the user asked for.",
  );

  return lines.join("\n");
}
