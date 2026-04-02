import type { IMessageSDK, Message } from "@photon-ai/imessage-kit";
import { config } from "./config.js";
import {
  formatForImessage,
  parseDraftJson,
  runDraftEngine,
} from "./draftEngine.js";
import { parseIntent } from "./intentParser.js";
import { memoryStore } from "./memoryStore.js";
import { isForDrafts, stripRoutingPrefix } from "./routing.js";
import { scheduleReminder } from "./reminderService.js";

function userKey(msg: Message): string {
  return msg.sender;
}

export function createInboundHandler(sdk: IMessageSDK) {
  return async function handleInbound(msg: Message): Promise<void> {
    if (msg.isFromMe || msg.isReaction) return;

    const allowed = isForDrafts(msg);
    if (config.debug || config.logIncomingDms) {
      console.log(
        `[drafts] inbound DM sender=${JSON.stringify(msg.sender)} chatId=${msg.chatId} allowed=${allowed}`,
      );
    }
    if (!allowed) return;

    const rawText = msg.text ?? "";
    const text = stripRoutingPrefix(rawText);

    if (text.trim().toLowerCase() === "ping") {
      await sdk.send(msg.chatId, "pong");
      return;
    }

    await memoryStore.recordIncoming(userKey(msg), text);

    const intent = parseIntent(text);

    if (intent.type === "unknown") {
      await sdk.send(
        msg.chatId,
        "Send a drafting request (e.g. follow-up with a recruiter) or start with your prefix if configured.",
      );
      return;
    }

    try {
      const memory = await memoryStore.get(userKey(msg));
      const result = await runDraftEngine({ userText: text, intent, memory });

      if (result.reminder) {
        try {
          scheduleReminder(sdk, msg, result.reminder);
        } catch (e) {
          console.error("[drafts] scheduleReminder failed:", e);
        }
      }

      const drafts = result.variants.map((v) => v.text);
      await memoryStore.pushDrafts(userKey(msg), drafts);

      const out = formatForImessage(result);
      await sdk.send(msg.chatId, out);
    } catch (e) {
      const err = e as Error;
      console.error("[drafts] handler error:", err.message);
      if (config.debug) console.error(err);
      await sdk.send(
        msg.chatId,
        "Could not generate drafts right now. Check GEMINI_API_KEY and try again.",
      );
    }
  };
}
