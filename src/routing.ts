import type { Message } from "@photon-ai/imessage-kit";
import { config } from "./config.js";

function normalize(s: string): string {
  return s.replace(/\s/g, "").toLowerCase();
}

/**
 * Whether this inbound DM should be handled by Drafts (routing / safety gate).
 */
export function isForDrafts(msg: Message): boolean {
  if (msg.isFromMe || msg.isReaction) return false;
  if (msg.isGroupChat) return false;

  if (config.draftsMode === "any_dm") return true;

  if (config.draftsMode === "prefix") {
    const t = (msg.text ?? "").trimStart();
    return t.startsWith(config.draftsPrefix);
  }

  if (config.allowedSenders.length === 0) {
    return false;
  }

  const s = normalize(msg.sender);
  return config.allowedSenders.some((a) => normalize(a) === s);
}

/** Strip prefix from message body when in prefix mode (prompt uses the rest). */
export function stripRoutingPrefix(text: string): string {
  if (config.draftsMode !== "prefix") return text;
  const t = text.trimStart();
  if (t.startsWith(config.draftsPrefix)) {
    return t.slice(config.draftsPrefix.length).trimStart();
  }
  return text;
}
