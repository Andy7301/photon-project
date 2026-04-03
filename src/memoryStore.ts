import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.js";
import { appendTurn, createEmptySession } from "./draftSession.js";
import { mergeProfile } from "./profile.js";
import type { DraftVariant } from "./draftEngine.js";

export type UserProfile = {
  tone?: string;
  length?: "short" | "medium" | "long";
  styleNotes?: string[];
};

export type DraftVariantInSession = { label: string; text: string };

export type SessionTurn = {
  turn: number;
  variants: DraftVariantInSession[];
  createdAt: string;
};

export type RecipientHint = "recruiter" | "friend" | "professor" | "group" | "unknown";
export type DraftMode =
  | "follow_up"
  | "thank_you"
  | "apology"
  | "scheduling"
  | "invitation"
  | "networking"
  | "general";

export type ActiveSession = {
  id: string;
  startedAt: string;
  recipientHint?: RecipientHint;
  mode?: DraftMode;
  turns: SessionTurn[];
  /** Last explicit variant choice (0–2) */
  selectedVariantIndex?: number;
};

export type DraftStatus =
  | "created"
  | "edited"
  | "finalized"
  | "pending_send"
  | "sent"
  | "abandoned";

export type DraftRecord = {
  id: string;
  status: DraftStatus;
  session: ActiveSession;
  title?: string;
  recipientHint?: RecipientHint;
  mode?: DraftMode;
  createdAt: string;
  updatedAt: string;
  lastNudgedAt?: string;
  nudgeCount?: number;
};

export type NudgePreferences = {
  optOut?: boolean;
  snoozeUntil?: string;
};

export type UserMemory = {
  profile?: UserProfile;
  session?: ActiveSession | null;
  /** @deprecated migrated into profile.tone + session */
  tonePreference?: string;
  /** @deprecated migrated into session.turns */
  recentDrafts?: string[];
  lastIncoming?: string;
  updatedAt: string;
  drafts?: DraftRecord[];
  activeDraftId?: string | null;
  nudgePreferences?: NudgePreferences;
};

export type PendingReminderKind = "reminder" | "nudge";

export type PendingReminderRecord = {
  id: string;
  userKey: string;
  chatId: string;
  sendAt: string;
  draftSnapshot: string;
  reason: string;
  sessionId: string;
  kind?: PendingReminderKind;
  draftId?: string;
};

export type MemoryFile = {
  users: Record<string, UserMemory>;
  pendingReminders: PendingReminderRecord[];
};

function cloneSession(s: ActiveSession): ActiveSession {
  return JSON.parse(JSON.stringify(s)) as ActiveSession;
}

/** After edits, new content moves draft out of terminal/finalized states. */
function statusAfterEdit(d: DraftRecord): DraftStatus {
  if (d.status === "sent" || d.status === "abandoned") return "edited";
  if (d.status === "finalized" || d.status === "pending_send") return "edited";
  if (!d.session.turns?.length) return "created";
  return "edited";
}

export function migrateDraftsForUser(user: UserMemory): UserMemory {
  let drafts = user.drafts ?? [];
  let activeDraftId = user.activeDraftId;
  let session = user.session ?? null;

  if (drafts.length === 0 && session?.turns?.length) {
    const rec: DraftRecord = {
      id: session.id,
      status: "edited",
      session: cloneSession(session),
      recipientHint: session.recipientHint,
      mode: session.mode,
      createdAt: session.startedAt,
      updatedAt: user.updatedAt,
    };
    drafts = [rec];
    activeDraftId = rec.id;
  }

  if (drafts.length > 0) {
    if (activeDraftId) {
      const active = drafts.find((d) => d.id === activeDraftId);
      if (active) {
        session = cloneSession(active.session);
      } else {
        activeDraftId = drafts[0].id;
        session = cloneSession(drafts[0].session);
      }
    } else {
      activeDraftId = drafts[0].id;
      session = cloneSession(drafts[0].session);
    }
  }

  return { ...user, drafts, activeDraftId, session };
}

function logPersist(data: MemoryFile): void {
  if (!config.debug) return;
  const keys = Object.keys(data.users);
  console.log(
    `[drafts] memory saved → ${config.memoryPath} (${keys.length} sender key(s): ${keys.join(", ") || "none"}; ${data.pendingReminders?.length ?? 0} pending reminders)`,
  );
}

let writeChain: Promise<void> = Promise.resolve();

function migrateUser(user: UserMemory): UserMemory {
  let profile = user.profile;
  if (user.tonePreference && !profile?.tone) {
    profile = { ...profile, tone: user.tonePreference };
  }

  let session = user.session ?? null;
  if (!session && user.recentDrafts?.length) {
    const drafts = [...user.recentDrafts];
    const v0 = drafts[0] ?? "";
    const v1 = drafts[1] ?? v0;
    const v2 = drafts[2] ?? v0;
    session = {
      id: crypto.randomUUID(),
      startedAt: user.updatedAt,
      turns: [
        {
          turn: 1,
          variants: [
            { label: "warm", text: v0 },
            { label: "direct", text: v1 },
            { label: "concise", text: v2 },
          ],
          createdAt: user.updatedAt,
        },
      ],
    };
  }

  const out: UserMemory = {
    ...user,
    profile,
    session,
    updatedAt: user.updatedAt,
  };
  delete (out as { recentDrafts?: string[] }).recentDrafts;
  delete (out as { tonePreference?: string }).tonePreference;
  return migrateDraftsForUser(out);
}

function migrateFile(data: MemoryFile): MemoryFile {
  if (!data.pendingReminders) data.pendingReminders = [];
  const users: Record<string, UserMemory> = {};
  for (const [k, u] of Object.entries(data.users ?? {})) {
    users[k] = migrateUser(u);
  }
  for (const p of data.pendingReminders) {
    if (!p.kind) p.kind = "reminder";
  }
  return { ...data, users, pendingReminders: data.pendingReminders };
}

async function load(): Promise<MemoryFile> {
  try {
    const raw = await readFile(config.memoryPath, "utf8");
    const data = JSON.parse(raw) as MemoryFile;
    if (!data.users) data.users = {};
    return migrateFile(data);
  } catch {
    return { users: {}, pendingReminders: [] };
  }
}

async function persist(data: MemoryFile): Promise<void> {
  await mkdir(dirname(config.memoryPath), { recursive: true });
  await writeFile(config.memoryPath, JSON.stringify(data, null, 2), "utf8");
}

export const memoryStore = {
  async getFull(): Promise<MemoryFile> {
    return load();
  },

  async get(userKey: string): Promise<UserMemory | undefined> {
    const data = await load();
    const u = data.users[userKey];
    return u ? migrateUser(u) : undefined;
  },

  async recordIncoming(userKey: string, text: string): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = data.users[userKey] ?? {
        updatedAt: new Date().toISOString(),
      };
      data.users[userKey] = {
        ...migrateUser(prev),
        lastIncoming: text.slice(0, 2000),
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
  },

  async saveUser(userKey: string, memory: UserMemory): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      data.users[userKey] = { ...migrateUser(memory), updatedAt: new Date().toISOString() };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
  },

  async mergeProfile(userKey: string, updates: Partial<UserProfile>): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = migrateUser(data.users[userKey] ?? { updatedAt: new Date().toISOString() });
      data.users[userKey] = {
        ...prev,
        profile: mergeProfile(prev.profile, updates),
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
  },

  async mergeNudgePreferences(
    userKey: string,
    updates: Partial<NudgePreferences>,
  ): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = migrateUser(data.users[userKey] ?? { updatedAt: new Date().toISOString() });
      data.users[userKey] = {
        ...prev,
        nudgePreferences: { ...prev.nudgePreferences, ...updates },
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
  },

  async setSession(userKey: string, session: ActiveSession | null): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = migrateUser(data.users[userKey] ?? { updatedAt: new Date().toISOString() });
      const migrated = migrateDraftsForUser(prev);
      let drafts = [...(migrated.drafts ?? [])];
      const activeId = migrated.activeDraftId;
      if (session && activeId) {
        const ix = drafts.findIndex((d) => d.id === activeId);
        if (ix >= 0) {
          drafts[ix] = {
            ...drafts[ix],
            session,
            updatedAt: new Date().toISOString(),
          };
        }
      }
      data.users[userKey] = {
        ...migrated,
        session,
        drafts,
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
  },

  async appendSessionTurn(userKey: string, variants: DraftVariant[]): Promise<ActiveSession> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = migrateUser(data.users[userKey] ?? { updatedAt: new Date().toISOString() });
      let drafts = [...(prev.drafts ?? [])];
      let activeId = prev.activeDraftId;

      let activeDraft = drafts.find((d) => d.id === activeId);
      if (!activeDraft) {
        const s = prev.session ?? createEmptySession();
        activeDraft = {
          id: s.id,
          status: "created",
          session: s,
          createdAt: s.startedAt,
          updatedAt: new Date().toISOString(),
        };
        drafts.push(activeDraft);
        activeId = activeDraft.id;
      }

      const newSession = appendTurn(activeDraft.session, variants);
      const nextDraft: DraftRecord = {
        ...activeDraft,
        session: newSession,
        status: statusAfterEdit(activeDraft),
        updatedAt: new Date().toISOString(),
        recipientHint: newSession.recipientHint ?? activeDraft.recipientHint,
        mode: newSession.mode ?? activeDraft.mode,
      };
      const idx = drafts.findIndex((d) => d.id === nextDraft.id);
      if (idx >= 0) drafts[idx] = nextDraft;
      else drafts.push(nextDraft);

      data.users[userKey] = {
        ...prev,
        drafts,
        activeDraftId: activeId,
        session: newSession,
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
    const m = await memoryStore.get(userKey);
    return m?.session ?? createEmptySession();
  },

  async startFreshSession(userKey: string): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = migrateUser(data.users[userKey] ?? { updatedAt: new Date().toISOString() });
      const empty = createEmptySession();
      const newDraft: DraftRecord = {
        id: empty.id,
        status: "created",
        session: empty,
        createdAt: empty.startedAt,
        updatedAt: new Date().toISOString(),
      };
      const drafts = [...(prev.drafts ?? []), newDraft];
      data.users[userKey] = {
        ...prev,
        drafts,
        activeDraftId: newDraft.id,
        session: empty,
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
  },

  async setSelectedVariant(userKey: string, index: number): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = migrateUser(data.users[userKey] ?? { updatedAt: new Date().toISOString() });
      const activeId = prev.activeDraftId;
      if (!activeId) return;
      const drafts = [...(prev.drafts ?? [])];
      const ix = drafts.findIndex((d) => d.id === activeId);
      if (ix < 0) return;
      const d = drafts[ix];
      const session = { ...d.session, selectedVariantIndex: index };
      drafts[ix] = { ...d, session, updatedAt: new Date().toISOString() };
      data.users[userKey] = {
        ...prev,
        drafts,
        session,
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
  },

  async mergeSessionHints(
    userKey: string,
    hints: { recipientHint?: RecipientHint; mode?: DraftMode },
  ): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = migrateUser(data.users[userKey] ?? { updatedAt: new Date().toISOString() });
      const activeId = prev.activeDraftId;
      const drafts = [...(prev.drafts ?? [])];
      let session = prev.session ?? createEmptySession();
      session = { ...session, ...hints };
      if (activeId) {
        const ix = drafts.findIndex((d) => d.id === activeId);
        if (ix >= 0) {
          drafts[ix] = {
            ...drafts[ix],
            session,
            recipientHint: hints.recipientHint ?? drafts[ix].recipientHint,
            mode: hints.mode ?? drafts[ix].mode,
            updatedAt: new Date().toISOString(),
          };
        }
      }
      data.users[userKey] = {
        ...prev,
        drafts,
        session,
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
  },

  async updateDraftRecord(
    userKey: string,
    draftId: string,
    updater: (d: DraftRecord) => DraftRecord,
  ): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = migrateUser(data.users[userKey] ?? { updatedAt: new Date().toISOString() });
      const drafts = (prev.drafts ?? []).map((d) => (d.id === draftId ? updater(d) : d));
      let session = prev.session;
      if (prev.activeDraftId === draftId) {
        const active = drafts.find((x) => x.id === draftId);
        if (active) session = active.session;
      }
      data.users[userKey] = {
        ...prev,
        drafts,
        session,
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
  },

  async setActiveDraft(userKey: string, draftId: string): Promise<boolean> {
    let ok = false;
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = migrateUser(data.users[userKey] ?? { updatedAt: new Date().toISOString() });
      const d = (prev.drafts ?? []).find((x) => x.id === draftId);
      if (!d) return;
      ok = true;
      data.users[userKey] = {
        ...prev,
        activeDraftId: draftId,
        session: cloneSession(d.session),
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
    return ok;
  },

  async deleteDraft(userKey: string, draftId: string): Promise<boolean> {
    let ok = false;
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = migrateUser(data.users[userKey] ?? { updatedAt: new Date().toISOString() });
      const drafts = (prev.drafts ?? []).filter((d) => d.id !== draftId);
      if (drafts.length === (prev.drafts ?? []).length) return;
      ok = true;
      let activeDraftId = prev.activeDraftId;
      let session = prev.session;
      if (activeDraftId === draftId) {
        activeDraftId = drafts[drafts.length - 1]?.id ?? null;
        session = activeDraftId
          ? cloneSession(drafts.find((x) => x.id === activeDraftId)!.session)
          : null;
      }
      data.users[userKey] = {
        ...prev,
        drafts,
        activeDraftId,
        session,
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
    return ok;
  },

  /** @deprecated use appendSessionTurn */
  async pushDrafts(userKey: string, drafts: string[], toneHint?: string): Promise<void> {
    const variants: DraftVariant[] = [
      { label: "warm", text: drafts[0] ?? "" },
      { label: "direct", text: drafts[1] ?? drafts[0] ?? "" },
      { label: "concise", text: drafts[2] ?? drafts[0] ?? "" },
    ];
    await memoryStore.appendSessionTurn(userKey, variants);
    if (toneHint) {
      await memoryStore.mergeProfile(userKey, { tone: toneHint });
    }
  },

  async getPendingReminders(): Promise<PendingReminderRecord[]> {
    const data = await load();
    return data.pendingReminders ?? [];
  },

  async addPendingReminder(record: PendingReminderRecord): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      if (!data.pendingReminders) data.pendingReminders = [];
      const rec = { ...record, kind: record.kind ?? "reminder" };
      data.pendingReminders.push(rec);
      await persist(data);
      logPersist(data);
    });
    await writeChain;
  },

  async removePendingReminder(id: string): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      if (!data.pendingReminders) return;
      data.pendingReminders = data.pendingReminders.filter((p) => p.id !== id);
      await persist(data);
      logPersist(data);
    });
    await writeChain;
  },
};
