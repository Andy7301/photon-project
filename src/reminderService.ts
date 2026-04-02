import type { IMessageSDK, Message } from "@photon-ai/imessage-kit";
import { Reminders } from "@photon-ai/imessage-kit";
import { config } from "./config.js";
import { memoryStore } from "./memoryStore.js";

let reminders: Reminders | null = null;

function formatReminderBody(reason: string, draftSnapshot: string): string {
  const snap = draftSnapshot.trim();
  if (!snap) return reason;
  return `${reason}\n\n---\nYour draft:\n${snap}`;
}

function getReminders(sdk: IMessageSDK): Reminders {
  if (!reminders) {
    reminders = new Reminders(sdk, {
      onSent: (scheduled) => {
        if (scheduled.type === "once") {
          void memoryStore.removePendingReminder(scheduled.id);
        }
        if (config.debug) console.debug("[drafts] reminder sent", scheduled.id);
      },
      onError: (scheduled, err) => {
        console.error("[drafts] reminder error:", err?.message ?? err, scheduled?.id);
      },
    });
  }
  return reminders;
}

/**
 * Photon's `Reminders.at()` requires a parseable clock time. Bare words like "tomorrow"
 * fail; "tomorrow 9am" works. Normalize common LLM outputs before calling `at`.
 */
export function normalizePhotonTimeExpression(expression: string): string {
  const raw = expression.trim();
  const lower = raw.toLowerCase();

  if (lower === "tomorrow" || lower === "tmrw") return "tomorrow 9am";
  if (lower === "today") return "5pm";
  if (lower === "tonight") return "8pm";

  const weekdayOnly =
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
  if (weekdayOnly.test(raw)) {
    return `${raw} 9am`;
  }

  return raw;
}

/**
 * Schedule reminder, persist to JSON, resurface draft in the message body.
 */
export async function scheduleLinkedReminder(
  sdk: IMessageSDK,
  msg: Message,
  reminder: { naturalLanguageTime: string; reason: string },
  link: { draftSnapshot: string; sessionId: string; userKey: string },
): Promise<void> {
  const r = getReminders(sdk);
  const to = msg.chatId;
  const body = formatReminderBody(reminder.reason, link.draftSnapshot);
  const id = crypto.randomUUID();

  const raw = reminder.naturalLanguageTime.trim();
  const lower = raw.toLowerCase();

  if (lower.startsWith("in ")) {
    const duration = raw.replace(/^in\s+/i, "").trim();
    r.in(duration, to, body, { id });
  } else {
    const atExpr = normalizePhotonTimeExpression(raw);
    r.at(atExpr, to, body, { id });
  }

  let rec = r.get(id);
  if (!rec) {
    rec = r.list().find((x) => x.id === id);
  }
  const sendAt = rec?.scheduledFor ?? new Date(Date.now() + 60_000);

  await memoryStore.addPendingReminder({
    id,
    userKey: link.userKey,
    chatId: to,
    sendAt: sendAt.toISOString(),
    draftSnapshot: link.draftSnapshot,
    reason: reminder.reason,
    sessionId: link.sessionId,
  });
}

/** Re-queue pending reminders after restart (same ids for dedup). */
export async function restorePendingReminders(sdk: IMessageSDK): Promise<void> {
  const pending = await memoryStore.getPendingReminders();
  if (!pending.length) return;

  const r = getReminders(sdk);
  const now = Date.now();

  for (const p of pending) {
    const t = new Date(p.sendAt).getTime();
    if (t <= now) {
      await memoryStore.removePendingReminder(p.id);
      continue;
    }
    const body = formatReminderBody(p.reason, p.draftSnapshot);
    r.exact(new Date(p.sendAt), p.chatId, body, { id: p.id });
  }

  if (config.debug) {
    console.log(`[drafts] restored ${pending.length} pending reminder(s)`);
  }
}

export function destroyReminderService(): void {
  reminders?.destroy();
  reminders = null;
}
