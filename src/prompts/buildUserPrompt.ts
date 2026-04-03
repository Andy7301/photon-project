import type { ResolvedIntent } from "../intentResolver.js";
import type { UserMemory } from "../memoryStore.js";
import type { EngineOperation } from "../draftEngine.js";
import type { PromptAddenda } from "../intelligence/promptSelector.js";

export function buildUserPrompt(params: {
  userText: string;
  operation: EngineOperation;
  resolved: ResolvedIntent;
  memory: UserMemory | undefined;
  baseTexts?: string[];
  /** Rewrite-all or new_draft: exact variant count in JSON. */
  expectedVariantCount?: number;
  promptAddenda?: PromptAddenda;
}): string {
  const {
    userText,
    operation,
    resolved,
    memory,
    baseTexts,
    expectedVariantCount,
    promptAddenda,
  } = params;
  const lines: string[] = [];

  lines.push(`User message:\n${userText.trim()}`);

  if (promptAddenda?.userAddendum) {
    lines.push(`\n${promptAddenda.userAddendum}`);
  }

  lines.push(`\nOperation: ${operation}`);
  lines.push(`Resolved intent kind: ${resolved.kind}`);

  if (resolved.kind === "iterate" || resolved.kind === "reminder") {
    lines.push(`Constraints: ${resolved.constraints.join(" | ") || "(none)"}`);
  }
  if (resolved.kind === "iterate") {
    lines.push(`Iterate op: ${resolved.op}`);
    if (resolved.op === "rewrite") {
      lines.push(`Rewrite scope: ${resolved.rewriteScope}`);
      if (resolved.rewriteScope === "single") {
        lines.push(`Selection indices (0-based): ${resolved.selection.join(", ")}`);
      }
    } else {
      lines.push(
        `Combine indices (0-based): ${resolved.selection[0]}, ${resolved.selection[1]}`,
      );
    }
  }
  if (resolved.kind === "reminder") {
    lines.push(`Link reminder to current draft: ${resolved.linkToDraft}`);
  }

  if (resolved.kind === "new_draft" && expectedVariantCount !== undefined) {
    if (expectedVariantCount === 2) {
      lines.push(
        '\nReturn exactly TWO variants with labels "warm" and "direct" only (in that order).',
      );
    } else if (expectedVariantCount === 3) {
      lines.push(
        '\nReturn exactly THREE variants with labels "warm", "direct", and "concise" (each once).',
      );
    }
  }

  if (operation === "iterate" && baseTexts?.length) {
    if (
      resolved.kind === "iterate" &&
      resolved.op === "rewrite" &&
      resolved.rewriteScope === "all" &&
      expectedVariantCount !== undefined
    ) {
      const n = expectedVariantCount;
      if (n === 1) {
        lines.push(
          '\nReturn exactly ONE variant. Apply the user\'s constraint to the text below. Use label "direct" unless the edit clearly favors warmth ("warm") or brevity ("concise").',
        );
      } else if (n === 2) {
        lines.push(
          '\nParallel revision: return exactly TWO variants with labels "warm" and "direct" (in that order). Warm revises [1], direct revises [2].',
        );
      } else {
        lines.push(
          '\nParallel revision: return exactly THREE variants with labels "warm", "direct", "concise" (in that order). Each revises the corresponding input: warm→[1], direct→[2], concise→[3].',
        );
      }
    }
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
