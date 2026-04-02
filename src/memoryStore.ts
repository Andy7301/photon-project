import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.js";

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

let cache: MemoryFile | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<MemoryFile> {
  if (cache) return cache;
  try {
    const raw = await readFile(config.memoryPath, "utf8");
    cache = JSON.parse(raw) as MemoryFile;
    if (!cache.users) cache.users = {};
    return cache;
  } catch {
    cache = { users: {} };
    return cache;
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
      cache = data;
      await persist(data);
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
      cache = data;
      await persist(data);
    });
    await writeChain;
  },
};
