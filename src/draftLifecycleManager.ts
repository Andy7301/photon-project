import type { DraftRecord, DraftStatus } from "./memoryStore.js";

export type LifecycleEvent =
  | "edit"
  | "finalize"
  | "pending_send"
  | "mark_sent"
  | "abandon"
  | "resume_edit";

const terminal: DraftStatus[] = ["sent", "abandoned"];

export function transitionDraft(draft: DraftRecord, event: LifecycleEvent): DraftRecord {
  if (terminal.includes(draft.status) && event !== "resume_edit") {
    throw new Error(`Draft is ${draft.status}; start a new draft or switch to another.`);
  }

  const now = new Date().toISOString();
  let status = draft.status;
  let nudgeCount = draft.nudgeCount;

  switch (event) {
    case "edit":
      if (draft.session.turns.length === 0) status = "created";
      else status = "edited";
      break;
    case "finalize":
      if (!draft.session.turns?.length) {
        throw new Error("Nothing to finalize yet — ask for a draft first.");
      }
      status = "finalized";
      break;
    case "pending_send":
      if (!draft.session.turns?.length) throw new Error("No draft content yet.");
      status = "pending_send";
      break;
    case "mark_sent":
      status = "sent";
      break;
    case "abandon":
      status = "abandoned";
      break;
    case "resume_edit":
      if (draft.status === "sent" || draft.status === "abandoned") {
        status = draft.session.turns?.length ? "edited" : "created";
        nudgeCount = 0;
      }
      break;
    default:
      break;
  }

  return {
    ...draft,
    status,
    nudgeCount,
    updatedAt: now,
    recipientHint: draft.session.recipientHint ?? draft.recipientHint,
    mode: draft.session.mode ?? draft.mode,
  };
}

export function draftLabelForList(d: DraftRecord, index: number): string {
  const hint = d.recipientHint && d.recipientHint !== "unknown" ? d.recipientHint : null;
  const title = d.title?.trim();
  const base = title ?? hint ?? `Draft ${index + 1}`;
  return `${index + 1}) ${base} — ${d.status}`;
}
