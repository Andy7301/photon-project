export type DraftsMode = "allowlist" | "prefix" | "any_dm";

function parseBool(v: string | undefined): boolean {
  return v === "1" || v?.toLowerCase() === "true";
}

function parseDraftsMode(v: string | undefined): DraftsMode {
  if (v === "prefix" || v === "any_dm" || v === "allowlist") return v;
  return "allowlist";
}

export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  draftsMode: parseDraftsMode(process.env.DRAFTS_MODE),
  allowedSenders: (process.env.ALLOWED_SENDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  draftsPrefix: process.env.DRAFTS_PREFIX ?? "Drafts:",
  memoryPath: process.env.MEMORY_PATH ?? "./data/memory.json",
  debug: parseBool(process.env.DEBUG),
  /** Log every inbound DM: sender, chatId, and whether it passed routing (set true while debugging allowlist). */
  logIncomingDms: parseBool(process.env.LOG_INCOMING_DMS),
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
};

export function assertConfig(): void {
  if (!config.geminiApiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }
}
