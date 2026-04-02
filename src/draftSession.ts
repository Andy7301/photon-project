import type { ActiveSession, SessionTurn, UserMemory } from "./memoryStore.js";
import type { DraftVariant } from "./draftEngine.js";

export function newSessionId(): string {
  return crypto.randomUUID();
}

export function createEmptySession(): ActiveSession {
  return {
    id: newSessionId(),
    startedAt: new Date().toISOString(),
    turns: [],
  };
}

export function getLatestTurn(session: ActiveSession | null | undefined): SessionTurn | undefined {
  if (!session?.turns?.length) return undefined;
  return session.turns[session.turns.length - 1];
}

/** Flat list of variants from the latest turn, 0-based index. */
export function getLatestVariants(session: ActiveSession | null | undefined): DraftVariant[] {
  const t = getLatestTurn(session);
  return t?.variants?.length ? t.variants : [];
}

export function getVariantByIndex(
  session: ActiveSession | null | undefined,
  index: number,
): string | undefined {
  const v = getLatestVariants(session)[index];
  return v?.text;
}

export function appendTurn(session: ActiveSession, variants: DraftVariant[]): ActiveSession {
  const nextTurn = (getLatestTurn(session)?.turn ?? 0) + 1;
  const turn: SessionTurn = {
    turn: nextTurn,
    variants: variants.map((v) => ({ label: v.label, text: v.text })),
    createdAt: new Date().toISOString(),
  };
  return {
    ...session,
    turns: [...session.turns, turn],
  };
}

export function memoryHasSession(memory: UserMemory | undefined): boolean {
  return Boolean(memory?.session?.turns?.length);
}
