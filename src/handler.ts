import type { IMessageSDK, Message } from "@photon-ai/imessage-kit";
import { config } from "./config.js";
import {
  formatForImessage,
  runDraftEngine,
  type EngineOperation,
} from "./draftEngine.js";
import { getLatestVariants } from "./draftSession.js";
import { resolveIntent } from "./intentResolver.js";
import {
  memoryStore,
  type DraftMode,
  type RecipientHint,
  type UserProfile,
} from "./memoryStore.js";
import { isForDrafts, stripRoutingPrefix } from "./routing.js";
import { scheduleLinkedReminder } from "./reminderService.js";

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

    const key = userKey(msg);
    await memoryStore.recordIncoming(key, text);

    const memoryBefore = await memoryStore.get(key);
    const resolved = resolveIntent(text, {
      session: memoryBefore?.session,
      profile: memoryBefore?.profile,
    });

    if (resolved.kind === "clarify") {
      await sdk.send(msg.chatId, resolved.message);
      return;
    }

    if (resolved.kind === "new_draft") {
      await memoryStore.startFreshSession(key);
    }

    let memory = await memoryStore.get(key);

    let operation: EngineOperation = "new_draft";
    let baseTexts: string[] | undefined;

    if (resolved.kind === "iterate") {
      operation = resolved.op === "combine" ? "combine" : "iterate";
      const latest = getLatestVariants(memory?.session ?? null);
      if (resolved.op === "combine") {
        const [a, b] = resolved.selection;
        const ta = latest[a]?.text;
        const tb = latest[b]?.text;
        if (!ta || !tb) {
          await sdk.send(
            msg.chatId,
            "Couldn’t find those options. Reply with 1, 2, or 3 after your latest drafts.",
          );
          return;
        }
        baseTexts = [ta, tb];
      } else {
        const idx = resolved.selection[0] ?? 0;
        await memoryStore.setSelectedVariant(key, idx);
        memory = await memoryStore.get(key);
        const latest2 = getLatestVariants(memory?.session ?? null);
        const t = latest2[idx]?.text;
        if (!t) {
          await sdk.send(msg.chatId, "Couldn’t find that option. Try 1, 2, or 3.");
          return;
        }
        baseTexts = [t];
      }
    }

    if (resolved.kind === "reminder") {
      if (resolved.linkToDraft && memoryBefore?.session?.turns?.length) {
        const latest = getLatestVariants(memoryBefore.session);
        const idx = memoryBefore.session.selectedVariantIndex ?? 0;
        const t = latest[idx]?.text ?? latest[0]?.text;
        if (t) {
          operation = "iterate";
          baseTexts = [t];
        }
      }
    }

    try {
      memory = await memoryStore.get(key);

      const result = await runDraftEngine({
        userText: text,
        operation,
        resolved,
        memory,
        baseTexts,
      });

      if (result.preferenceUpdates) {
        const u = result.preferenceUpdates;
        const patch: Partial<UserProfile> = {};
        if (u.tone) patch.tone = u.tone;
        if (u.length) patch.length = u.length;
        if (u.styleNotes?.length) patch.styleNotes = u.styleNotes;
        if (Object.keys(patch).length) {
          await memoryStore.mergeProfile(key, patch);
        }
      }

      if (result.reminder) {
        try {
          memory = await memoryStore.get(key);
          const draftSnap =
            result.variants[memory?.session?.selectedVariantIndex ?? 0]?.text ??
            result.variants[0]?.text ??
            "";
          await scheduleLinkedReminder(sdk, msg, result.reminder, {
            draftSnapshot: draftSnap,
            sessionId: memory?.session?.id ?? "none",
            userKey: key,
          });
        } catch (e) {
          console.error("[drafts] scheduleLinkedReminder failed:", e);
        }
      }

      await memoryStore.appendSessionTurn(key, result.variants);

      const hints: {
        recipientHint?: RecipientHint;
        mode?: DraftMode;
      } = {};
      if (result.recipientHint && result.recipientHint !== "unknown") {
        hints.recipientHint = result.recipientHint;
      }
      if (result.mode && result.mode !== "general") {
        hints.mode = result.mode;
      }
      if (Object.keys(hints).length) {
        await memoryStore.mergeSessionHints(key, hints);
      }

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
