import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.js";

function logPersist(data: MemoryFile): void {
  if (!config.debug) return;
  const keys = Object.keys(data.users);
  console.log(
    `[drafts] memory saved → ${config.memoryPath} (${keys.length} sender key(s): ${keys.join(", ") || "none"})`,
  );
}

export type UserMemory = {
  tonePreference?: string;
  recentDrafts: string[];
  lastIncoming?: string;
  updatedAt: string;
};

export type MemoryFile = {
  users: Record<string, UserMemory>;
};

const MAX_DRAFTS = 8;

let writeChain: Promise<void> = Promise.resolve();

/** Always read from disk so concurrent updates and IDE saves stay consistent. */
async function load(): Promise<MemoryFile> {
  try {
    const raw = await readFile(config.memoryPath, "utf8");
    const data = JSON.parse(raw) as MemoryFile;
    if (!data.users) data.users = {};
    return data;
  } catch {
    return { users: {} };
  }
}

async function persist(data: MemoryFile): Promise<void> {
  await mkdir(dirname(config.memoryPath), { recursive: true });
  await writeFile(config.memoryPath, JSON.stringify(data, null, 2), "utf8");
}

export const memoryStore = {
  async get(userKey: string): Promise<UserMemory | undefined> {
    const data = await load();
    return data.users[userKey];
  },

  async recordIncoming(userKey: string, text: string): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = data.users[userKey] ?? {
        recentDrafts: [],
        updatedAt: new Date().toISOString(),
      };
      data.users[userKey] = {
        ...prev,
        lastIncoming: text.slice(0, 2000),
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
  },

  async pushDrafts(userKey: string, drafts: string[], toneHint?: string): Promise<void> {
    writeChain = writeChain.then(async () => {
      const data = await load();
      const prev = data.users[userKey] ?? {
        recentDrafts: [],
        updatedAt: new Date().toISOString(),
      };
      const merged = [...drafts, ...prev.recentDrafts].slice(0, MAX_DRAFTS);
      data.users[userKey] = {
        ...prev,
        recentDrafts: merged,
        tonePreference: toneHint ?? prev.tonePreference,
        updatedAt: new Date().toISOString(),
      };
      await persist(data);
      logPersist(data);
    });
    await writeChain;
  },
};
