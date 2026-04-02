import type { ResolvedIntent } from "../intentResolver.js";
import type { UserMemory } from "../memoryStore.js";
import type { EngineOperation } from "../draftEngine.js";
import { modeLine, recipientHintLine } from "./modes.js";

export function buildUserPrompt(params: {
  userText: string;
  operation: EngineOperation;
  resolved: ResolvedIntent;
  memory: UserMemory | undefined;
  baseTexts?: string[];
}): string {
  const { userText, operation, resolved, memory, baseTexts } = params;
  const lines: string[] = [];

  lines.push(`User message:\n${userText.trim()}`);

  lines.push(`\nOperation: ${operation}`);
  lines.push(`Resolved intent kind: ${resolved.kind}`);

  if (resolved.kind === "iterate" || resolved.kind === "reminder") {
    lines.push(`Constraints: ${resolved.constraints.join(" | ") || "(none)"}`);
  }
  if (resolved.kind === "iterate") {
    lines.push(`Iterate op: ${resolved.op}`);
    lines.push(`Selection indices (0-based): ${resolved.selection.join(", ")}`);
  }
  if (resolved.kind === "reminder") {
    lines.push(`Link reminder to current draft: ${resolved.linkToDraft}`);
  }

  if (operation === "iterate" && baseTexts?.length) {
    lines.push("\nText to transform (follow the user's constraints):");
    baseTexts.forEach((t, i) => lines.push(`[${i + 1}] ${t}`));
  }

  if (operation === "combine" && baseTexts && baseTexts.length >= 2) {
    lines.push("\nCombine these into one message that preserves intent from both:");
    lines.push(`A: ${baseTexts[0]}`);
    lines.push(`B: ${baseTexts[1]}`);
  }

  const profile = memory?.profile;
  if (profile?.tone) {
    lines.push(`\nUser tone preference: ${profile.tone}`);
  }
  if (profile?.length) {
    lines.push(`Length preference: ${profile.length}`);
  }
  if (profile?.styleNotes?.length) {
    lines.push(`Style notes: ${profile.styleNotes.join("; ")}`);
  }

  const session = memory?.session;
  if (session?.recipientHint) {
    const r = recipientHintLine(session.recipientHint);
    if (r) lines.push(`\n${r}`);
  }
  if (session?.mode) {
    const m = modeLine(session.mode);
    if (m) lines.push(m);
  }

  if (session?.turns?.length) {
    const last = session.turns[session.turns.length - 1];
    lines.push("\nPrevious turn variants (for context; rewrite or improve as requested):");
    for (const v of last.variants) {
      lines.push(`- ${v.label}: ${v.text.slice(0, 400)}${v.text.length > 400 ? "…" : ""}`);
    }
  }

  lines.push(
    "\nReturn JSON only per the system schema. If reminder is appropriate, include naturalLanguageTime.",
  );

  return lines.join("\n");
}
