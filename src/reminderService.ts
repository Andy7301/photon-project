import type { IMessageSDK, Message } from "@photon-ai/imessage-kit";
import { Reminders } from "@photon-ai/imessage-kit";
import { config } from "./config.js";

let reminders: Reminders | null = null;

function getReminders(sdk: IMessageSDK): Reminders {
  if (!reminders) {
    reminders = new Reminders(sdk, {
      onSent: (_msg, _result) => {
        if (config.debug) console.debug("[drafts] reminder sent");
      },
      onError: (scheduled, err) => {
        console.error("[drafts] reminder error:", err?.message ?? err, scheduled?.id);
      },
    });
  }
  return reminders;
}

/**
 * Schedule a follow-up text using Photon's natural-language time parser.
 * Prefer `at` for clock times; use `in` when the model returns "in 5 minutes" style strings.
 */
export function scheduleReminder(
  sdk: IMessageSDK,
  msg: Message,
  reminder: { naturalLanguageTime: string; reason: string },
): string {
  const r = getReminders(sdk);
  const to = msg.chatId;
  const body = `Reminder: ${reminder.reason}`;

  const raw = reminder.naturalLanguageTime.trim();
  const lower = raw.toLowerCase();

  if (lower.startsWith("in ")) {
    const duration = raw.replace(/^in\s+/i, "").trim();
    return r.in(duration, to, body);
  }

  return r.at(raw, to, body);
}

export function destroyReminderService(): void {
  reminders?.destroy();
  reminders = null;
}
