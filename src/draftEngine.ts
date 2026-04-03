import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";
import { buildUserPrompt } from "./prompts/buildUserPrompt.js";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import type { UserMemory } from "./memoryStore.js";
import type { ResolvedIntent } from "./intentResolver.js";

export type DraftVariant = { label: string; text: string };

export type ParsedDraftResult = {
  variants: DraftVariant[];
  reminder: null | { naturalLanguageTime: string; reason: string };
  recipientHint?: "recruiter" | "friend" | "professor" | "group" | "unknown" | null;
  mode?:
    | "follow_up"
    | "thank_you"
    | "apology"
    | "scheduling"
    | "invitation"
    | "networking"
    | "general"
    | null;
  preferenceUpdates?: {
    tone?: string | null;
    length?: "short" | "medium" | "long" | null;
    styleNotes?: string[] | null;
  } | null;
};

export type EngineOperation = "new_draft" | "iterate" | "combine";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

function stripJsonFence(s: string): string {
  const trimmed = s.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m;
  const m = trimmed.match(fence);
  if (m) return m[1].trim();
  return trimmed;
}

export function parseDraftJson(
  raw: string,
  expectedVariantCount?: number,
): ParsedDraftResult {
  const inner = stripJsonFence(raw);
  const parsed = JSON.parse(inner) as ParsedDraftResult;
  if (!parsed.variants || !Array.isArray(parsed.variants)) {
    throw new Error("Invalid response: missing variants");
  }
  if (
    expectedVariantCount !== undefined &&
    parsed.variants.length !== expectedVariantCount
  ) {
    throw new Error(
      `Invalid response: expected ${expectedVariantCount} variants, got ${parsed.variants.length}`,
    );
  }
  return parsed;
}

export function formatForImessage(result: ParsedDraftResult): string {
  return formatForImessageWithRender(result, { renderCount: 3 });
}

export function formatForImessageWithRender(
  result: ParsedDraftResult,
  opts: { renderCount: 1 | 2 | 3; selectedIndex?: number },
): string {
  const renderCount = opts.renderCount;
  const reminderFooter = result.reminder
    ? `\n\n—\n\nReminder set: ${result.reminder.naturalLanguageTime} (${result.reminder.reason})`
    : "";

  if (renderCount === 1) {
    const idx = opts.selectedIndex ?? 1;
    const v = result.variants[idx] ?? result.variants[0];
    const text = v?.text?.trim() ?? "";
    return `${text}${reminderFooter}`;
  }

  const slice = result.variants.slice(0, renderCount);
  const blocks = slice.map((v, i) => {
    const n = i + 1;
    const label = v.label.charAt(0).toUpperCase() + v.label.slice(1);
    return `${n}) ${label}\n${v.text.trim()}`;
  });
  return `${blocks.join("\n\n—\n\n")}${reminderFooter}`;
}

export async function runDraftEngine(params: {
  userText: string;
  operation: EngineOperation;
  resolved: ResolvedIntent;
  memory: UserMemory | undefined;
  baseTexts?: string[];
  /** When set (rewrite-all), JSON must contain exactly this many variants. */
  expectedVariantCount?: number;
}): Promise<ParsedDraftResult> {
  const { userText, operation, resolved, memory, baseTexts, expectedVariantCount } =
    params;

  const userPrompt = buildUserPrompt({
    userText,
    operation,
    resolved,
    memory,
    baseTexts,
    expectedVariantCount,
  });

  const response = await ai.models.generateContent({
    model: config.geminiModel,
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      temperature: 0.7,
    },
  });

  const text = response.text ?? "";
  return parseDraftJson(text, expectedVariantCount);
}
