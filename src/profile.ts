import type { UserProfile } from "./memoryStore.js";

export function mergeProfile(
  prev: UserProfile | undefined,
  updates: Partial<UserProfile> | undefined,
): UserProfile {
  if (!updates || Object.keys(updates).length === 0) return prev ?? {};
  return {
    ...prev,
    ...updates,
    styleNotes: mergeStyleNotes(prev?.styleNotes, updates.styleNotes),
  };
}

function mergeStyleNotes(
  a: string[] | undefined,
  b: string[] | undefined,
): string[] | undefined {
  if (!b?.length) return a;
  if (!a?.length) return b;
  return [...new Set([...a, ...b])].slice(-10);
}
