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

export type UserMemory = {
  profile?: UserProfile;
  session?: ActiveSession | null;
  /** @deprecated migrated into profile.tone + session */
  tonePreference?: string;
  /** @deprecated migrated into session.turns */
  recentDrafts?: string[];
  lastIncoming?: string;
  updatedAt: string;
};

export type PendingReminderRecord = {
  id: string;
  userKey: string;
  chatId: string;
  sendAt: string;
  draftSnapshot: string;
  reason: string;
  sessionId: string;
};

export type MemoryFile = {
  users: Record<string, UserMemory>;
  pendingReminders: PendingReminderRecord[];
};

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
  return out;
}

function migrateFile(data: MemoryFile): MemoryFile {
  if (!data.pendingReminders) data.pendingReminders = [];
  const users: Record<string, UserMemory> = {};
  for (const [k, u] of Object.entries(data.users ?? {})) {
    users[k] = migrateUser(u);
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
    return data.users[userKey];
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
      data.users[userKey] = { ...memory, updatedAt: new Date().toISOString() };
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

  async setSession(userKey: string, session: ActiveSession | null): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = migrateUser(data.users[userKey] ?? { updatedAt: new Date().toISOString() });
      data.users[userKey] = {
        ...prev,
        session,
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
      let session = prev.session ?? createEmptySession();
      session = appendTurn(session, variants);
      data.users[userKey] = {
        ...prev,
        session,
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
    await memoryStore.setSession(userKey, createEmptySession());
  },

  async setSelectedVariant(userKey: string, index: number): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = migrateUser(data.users[userKey] ?? { updatedAt: new Date().toISOString() });
      if (!prev.session) return;
      data.users[userKey] = {
        ...prev,
        session: { ...prev.session, selectedVariantIndex: index },
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
      let session = prev.session ?? createEmptySession();
      session = { ...session, ...hints };
      data.users[userKey] = {
        ...prev,
        session,
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
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
      data.pendingReminders.push(record);
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
