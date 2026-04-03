import type { IMessageSDK, Message } from "@photon-ai/imessage-kit";
import { config } from "./config.js";
import {
  formatForImessageWithRender,
  runDraftEngine,
  type EngineOperation,
} from "./draftEngine.js";
import { getLatestVariants } from "./draftSession.js";
import { mergeDraftContext, shouldClarifyAudienceForNewDraft } from "./intelligence/mergeDraftContext.js";
import { selectPromptParts } from "./intelligence/promptSelector.js";
import { resolveIntent, wantsExplicitAlternatives } from "./intentResolver.js";
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

    const merged = mergeDraftContext(text, memoryBefore);
    const promptAddenda = selectPromptParts({
      ctx: merged,
      profile: memoryBefore?.profile,
      userText: text,
    });

    if (
      resolved.kind === "new_draft" &&
      shouldClarifyAudienceForNewDraft(merged, memoryBefore, text)
    ) {
      await sdk.send(
        msg.chatId,
        "Quick check: is this for a recruiter, a friend, a professor, or someone else? One word is fine — then I’ll tailor the draft.",
      );
      return;
    }

    if (resolved.kind === "new_draft") {
      await memoryStore.startFreshSession(key);
    }

    let memory = await memoryStore.get(key);

    let operation: EngineOperation = "new_draft";
    let baseTexts: string[] | undefined;
    /** Rewrite-all or new_draft: exact variant count for JSON validation. */
    let expectedVariantCount: number | undefined;

    if (resolved.kind === "new_draft") {
      expectedVariantCount = merged.isReplyRequest ? 2 : 3;
    }

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
      } else if (resolved.rewriteScope === "all") {
        if (!latest.length) {
          await sdk.send(
            msg.chatId,
            "No draft to refine. Ask for a new draft first.",
          );
          return;
        }
        const n = Math.min(3, latest.length);
        // One prior draft → one output unless user explicitly asks for three alternatives.
        expectedVariantCount = wantsExplicitAlternatives(text) && n === 1 ? 3 : n;
        baseTexts =
          latest.length >= 3
            ? latest.slice(0, 3).map((v) => v.text)
            : latest.map((v) => v.text);
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
        expectedVariantCount,
        promptAddenda,
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
      const rh =
        result.recipientHint && result.recipientHint !== "unknown"
          ? result.recipientHint
          : merged.recipient !== "unknown"
            ? merged.recipient
            : undefined;
      const md =
        result.mode && result.mode !== "general"
          ? result.mode
          : merged.mode !== "general"
            ? merged.mode
            : undefined;
      if (rh) hints.recipientHint = rh;
      if (md) hints.mode = md;
      if (Object.keys(hints).length) {
        await memoryStore.mergeSessionHints(key, hints);
      }

      const renderCount: 1 | 2 | 3 =
        resolved.kind === "new_draft" && expectedVariantCount !== undefined
          ? (expectedVariantCount as 1 | 2 | 3)
          : resolved.kind === "iterate" &&
              resolved.op === "rewrite" &&
              resolved.rewriteScope === "all" &&
              expectedVariantCount !== undefined
            ? (expectedVariantCount as 1 | 2 | 3)
            : resolved.wantMultipleOptions
              ? 3
              : 1;
      let selectedIndex: number | undefined;
      if (renderCount === 1) {
        const combined = `${text}\n${resolved.constraints.join(" ")}`.toLowerCase();
        const wantsShorter = /shorter|tight|concise|condense|tighten|trim/.test(combined);
        const wantsWarmer = /warmer|warm|polite|friendly|confident|more confident/.test(combined);
        const desiredLabel = wantsShorter ? "concise" : wantsWarmer ? "warm" : "direct";
        const found = result.variants.findIndex((v) => v.label === desiredLabel);
        selectedIndex =
          found >= 0
            ? found
            : desiredLabel === "warm"
              ? 0
              : desiredLabel === "concise"
                ? 2
                : 1;
      }

      const out = formatForImessageWithRender(result, {
        renderCount,
        selectedIndex,
      });
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
