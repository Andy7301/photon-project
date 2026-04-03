import type { IMessageSDK, Message } from "@photon-ai/imessage-kit";
import { config } from "./config.js";
import {
  formatForImessageWithRender,
  runDraftEngine,
  type EngineOperation,
} from "./draftEngine.js";
import { draftLabelForList, transitionDraft } from "./draftLifecycleManager.js";
import { resolveDraftReference } from "./draftReferenceResolver.js";
import { getLatestVariants } from "./draftSession.js";
import { mergeDraftContext, shouldClarifyAudienceForNewDraft } from "./intelligence/mergeDraftContext.js";
import { selectPromptParts } from "./intelligence/promptSelector.js";
import { bumpNudgeMeta, maybeScheduleNudge } from "./nudgeEngine.js";
import { resolveIntent, wantsExplicitAlternatives } from "./intentResolver.js";
import {
  memoryStore,
  type ActiveSession,
  type DraftMode,
  type RecipientHint,
  type UserProfile,
} from "./memoryStore.js";
import { isForDrafts, stripRoutingPrefix } from "./routing.js";
import { scheduleLinkedReminder, scheduleNudge } from "./reminderService.js";

function userKey(msg: Message): string {
  return msg.sender;
}

function latestDraftSnippet(session: ActiveSession | null | undefined): string {
  const latest = getLatestVariants(session ?? null);
  const idx = session?.selectedVariantIndex ?? 0;
  return (latest[idx] ?? latest[0])?.text?.trim() ?? "";
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

    let memoryBefore = await memoryStore.get(key);
    const resolved = resolveIntent(text, {
      session: memoryBefore?.session,
      profile: memoryBefore?.profile,
      drafts: memoryBefore?.drafts,
      activeDraftId: memoryBefore?.activeDraftId,
    });

    if (resolved.kind === "clarify") {
      await sdk.send(msg.chatId, resolved.message);
      return;
    }

    if (resolved.kind === "list_drafts") {
      const drafts = memoryBefore?.drafts ?? [];
      if (!drafts.length) {
        await sdk.send(msg.chatId, "No saved drafts yet. Ask me to draft something first.");
        return;
      }
      const lines = drafts.map((d, i) => draftLabelForList(d, i));
      const active = memoryBefore?.activeDraftId;
      await sdk.send(
        msg.chatId,
        `Your drafts:\n${lines.join("\n")}${active ? `\n\nActive: ${active.slice(0, 8)}…` : ""}`,
      );
      return;
    }

    if (resolved.kind === "delete_draft") {
      const id = resolveDraftReference(
        resolved.targetHint ?? text,
        memoryBefore?.drafts ?? [],
        memoryBefore?.activeDraftId,
      );
      if (!id) {
        await sdk.send(
          msg.chatId,
          "Which draft? Say e.g. “delete draft 2” or “delete the recruiter draft”.",
        );
        return;
      }
      const ok = await memoryStore.deleteDraft(key, id);
      await sdk.send(
        msg.chatId,
        ok ? "Deleted that draft." : "Couldn’t find that draft.",
      );
      return;
    }

    if (resolved.kind === "switch_draft") {
      const id = resolveDraftReference(
        resolved.targetHint ?? text,
        memoryBefore?.drafts ?? [],
        memoryBefore?.activeDraftId,
      );
      if (!id) {
        await sdk.send(
          msg.chatId,
          "Which draft? Say e.g. “switch to draft 2” or “resume the recruiter one”.",
        );
        return;
      }
      const ok = await memoryStore.setActiveDraft(key, id);
      memoryBefore = await memoryStore.get(key);
      await sdk.send(
        msg.chatId,
        ok
          ? `Switched to that draft (${memoryBefore?.drafts?.find((d) => d.id === id)?.status ?? "ready"}).`
          : "Couldn’t switch.",
      );
      return;
    }

    if (resolved.kind === "nudge_prefs") {
      if (resolved.action === "opt_out") {
        await memoryStore.mergeNudgePreferences(key, { optOut: true });
        await sdk.send(msg.chatId, "Okay — I won’t nudge you about drafts. Say “resume nudges” anytime.");
        return;
      }
      if (resolved.action === "resume") {
        await memoryStore.mergeNudgePreferences(key, { optOut: false, snoozeUntil: undefined });
        await sdk.send(msg.chatId, "Nudges are back on.");
        return;
      }
      const hours = resolved.hours ?? 24;
      const until = new Date(Date.now() + hours * 3600_000).toISOString();
      await memoryStore.mergeNudgePreferences(key, { snoozeUntil: until });
      await sdk.send(msg.chatId, `Snoozed nudges for about ${hours}h.`);
      return;
    }

    if (resolved.kind === "copy_send") {
      memoryBefore = await memoryStore.get(key);
      const snap = latestDraftSnippet(memoryBefore?.session);
      if (!snap) {
        await sdk.send(msg.chatId, "No draft text yet. Ask for a draft first.");
        return;
      }
      if (resolved.action === "copy") {
        await sdk.send(
          msg.chatId,
          `Copy-ready:\n\n${snap}\n\n—\nPaste into Messages when you’re ready.`,
        );
        return;
      }
      await sdk.send(
        msg.chatId,
        `Here’s your text to send:\n\n${snap}\n\n—\nCopy the block above and send when you like.`,
      );
      return;
    }

    if (resolved.kind === "lifecycle") {
      memoryBefore = await memoryStore.get(key);
      const activeId = memoryBefore?.activeDraftId;
      const draft = memoryBefore?.drafts?.find((d) => d.id === activeId);
      if (!draft) {
        await sdk.send(msg.chatId, "No active draft. Start with what you want to say.");
        return;
      }
      try {
        const action =
          resolved.action === "finalize"
            ? "finalize"
            : resolved.action === "pending_send"
              ? "pending_send"
              : resolved.action === "mark_sent"
                ? "mark_sent"
                : "abandon";
        const next = transitionDraft(draft, action);
        await memoryStore.updateDraftRecord(key, draft.id, () => next);

        if (action === "finalize") {
          const mem = await memoryStore.get(key);
          const d = mem?.drafts?.find((x) => x.id === draft.id);
          if (d) {
            const plan = maybeScheduleNudge(mem, d, new Date(), { forceAfterFinalize: true });
            if (plan) {
              try {
                await scheduleNudge(sdk, msg, plan, {
                  userKey: key,
                  sessionId: d.session.id,
                });
                await memoryStore.updateDraftRecord(key, d.id, (dr) => bumpNudgeMeta(dr));
              } catch (e) {
                console.error("[drafts] scheduleNudge failed:", e);
              }
            }
          }
        }

        const msgOut =
          action === "finalize"
            ? "Marked final. I’ll check in later if you want a nudge to send."
            : action === "pending_send"
              ? "Queued mentally — say **copy** when you’re ready to paste."
              : action === "mark_sent"
                ? "Nice — marked sent."
                : "Forgotten. Start a new draft anytime.";
        await sdk.send(msg.chatId, msgOut);
      } catch (e) {
        await sdk.send(msg.chatId, (e as Error).message ?? "Couldn’t update draft.");
      }
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
        const constraints =
          resolved.kind === "iterate" || resolved.kind === "reminder"
            ? resolved.constraints.join(" ")
            : "";
        const combined = `${text}\n${constraints}`.toLowerCase();
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
