import type { DraftRecord } from "./memoryStore.js";
import type { UserMemory } from "./memoryStore.js";

const MAX_NUDGES_PER_DRAFT = 3;
const MIN_HOURS_BETWEEN_NUDGES = 24;
const HOURS_AFTER_FINALIZE_BEFORE_FIRST_NUDGE = 4;

export type NudgeSchedulePlan = {
  draftId: string;
  /** Photon-friendly time expression */
  when: string;
  reason: string;
  bodySuffix: string;
};

function hoursBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 36e5;
}

export type NudgeOptions = {
  /** User just finalized — schedule follow-up nudge without waiting for age of draft. */
  forceAfterFinalize?: boolean;
};

/**
 * Schedule at most one nudge per call; respects opt-out, snooze, caps, cooldown.
 */
export function maybeScheduleNudge(
  memory: UserMemory | undefined,
  draft: DraftRecord,
  now: Date = new Date(),
  opts?: NudgeOptions,
): NudgeSchedulePlan | null {
  const prefs = memory?.nudgePreferences;
  if (prefs?.optOut) return null;
  if (prefs?.snoozeUntil && new Date(prefs.snoozeUntil) > now) return null;

  if (draft.status !== "finalized" && draft.status !== "pending_send") return null;

  const count = draft.nudgeCount ?? 0;
  if (count >= MAX_NUDGES_PER_DRAFT) return null;

  if (draft.lastNudgedAt) {
    const h = hoursBetween(draft.lastNudgedAt, now.toISOString());
    if (h < MIN_HOURS_BETWEEN_NUDGES) return null;
  } else if (!opts?.forceAfterFinalize) {
    const updated = new Date(draft.updatedAt);
    const hoursSinceUpdate = (now.getTime() - updated.getTime()) / 36e5;
    if (hoursSinceUpdate < HOURS_AFTER_FINALIZE_BEFORE_FIRST_NUDGE) return null;
  }

  const hint = draft.recipientHint && draft.recipientHint !== "unknown" ? draft.recipientHint : "this";
  const snap =
    draft.session.turns?.at(-1)?.variants?.[0]?.text?.slice(0, 120) ?? "(draft)";

  return {
    draftId: draft.id,
    when: "in 4 hours",
    reason: `Follow-up: ${hint} draft`,
    bodySuffix: `Draft id: ${draft.id}\nStill want to send? Reply **tweak**, **copy**, or **done**.\n\n${snap}${snap.length >= 120 ? "…" : ""}`,
  };
}

export function bumpNudgeMeta(draft: DraftRecord): DraftRecord {
  const now = new Date().toISOString();
  return {
    ...draft,
    lastNudgedAt: now,
    nudgeCount: (draft.nudgeCount ?? 0) + 1,
    updatedAt: now,
  };
}
