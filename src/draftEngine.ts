import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";
import type { Intent } from "./intentParser.js";
import { buildUserPrompt } from "./prompts/buildUserPrompt.js";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import type { UserMemory } from "./memoryStore.js";

export type DraftVariant = { label: string; text: string };

export type ParsedDraftResult = {
  variants: DraftVariant[];
  reminder: null | { naturalLanguageTime: string; reason: string };
};

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

function stripJsonFence(s: string): string {
  const trimmed = s.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m;
  const m = trimmed.match(fence);
  if (m) return m[1].trim();
  return trimmed;
}

export function parseDraftJson(raw: string): ParsedDraftResult {
  const inner = stripJsonFence(raw);
  const parsed = JSON.parse(inner) as ParsedDraftResult;
  if (!parsed.variants || !Array.isArray(parsed.variants)) {
    throw new Error("Invalid response: missing variants");
  }
  return parsed;
}

export function formatForImessage(result: ParsedDraftResult): string {
  const blocks = result.variants.map((v) => {
    const label = v.label.charAt(0).toUpperCase() + v.label.slice(1);
    return `${label}\n${v.text.trim()}`;
  });
  let out = blocks.join("\n\n—\n\n");
  if (result.reminder) {
    out += `\n\n—\n\nReminder set: ${result.reminder.naturalLanguageTime} (${result.reminder.reason})`;
  }
  return out;
}

export async function runDraftEngine(params: {
  userText: string;
  intent: Intent;
  memory: UserMemory | undefined;
}): Promise<ParsedDraftResult> {
  const { userText, intent, memory } = params;

  let intentForPrompt: Intent = intent;
  if (intent.type === "rewrite" && !intent.previousUserText && memory?.recentDrafts?.[0]) {
    intentForPrompt = {
      ...intent,
      previousUserText: memory.recentDrafts[0],
    };
  }

  const userPrompt = buildUserPrompt({
    userText,
    intent: intentForPrompt,
    memory,
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
  return parseDraftJson(text);
}
