import * as core from '@zilar/client-core';
import { Effect, Schema } from 'effect';

import { useChatStore } from '@/store/chat-store-provider';

const FILE_NAME = 'zilar-composer-drafts.json';
const MAX_STORED_USERS = 5;
const decodeStoredDrafts = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String))),
);

async function readFile(): Promise<string | null> {
  try {
    const { documentDirectory, readAsStringAsync } = await import('expo-file-system/legacy');
    if (documentDirectory === null) return null;
    return await readAsStringAsync(documentDirectory + FILE_NAME);
  } catch {
    return null;
  }
}

async function writeFile(contents: string): Promise<void> {
  try {
    const { documentDirectory, writeAsStringAsync } = await import('expo-file-system/legacy');
    if (documentDirectory !== null)
      await writeAsStringAsync(documentDirectory + FILE_NAME, contents);
  } catch {
    // A read-only or full disk only costs persistence.
  }
}

let storedAll: Record<string, Map<string, string>> | undefined;
let loadPromise: Promise<void> | undefined;

function decodeFile(raw: string | null): Record<string, Map<string, string>> {
  if (raw === null) return {};
  const parsed = Effect.runSync(
    Effect.try(() => decodeStoredDrafts(raw)).pipe(Effect.orElseSucceed(() => ({}))),
  );
  return core.capStoredDrafts(parsed);
}

function ensureLoaded(): Promise<void> {
  loadPromise ??= readFile().then((raw) => {
    storedAll = decodeFile(raw);
  });
  return loadPromise;
}

const storage: core.DraftStorage = {
  async load(userId) {
    await ensureLoaded();
    return new Map(storedAll?.[userId] ?? []);
  },
  save(userId, drafts) {
    if (storedAll === undefined) {
      // Read the file first so the write keeps the other users' entries.
      void ensureLoaded().then(() => storage.save(userId, drafts));
      return;
    }
    delete storedAll[userId];
    storedAll[userId] = new Map(drafts);
    const users = Object.keys(storedAll);
    for (const id of users.slice(0, Math.max(0, users.length - MAX_STORED_USERS))) {
      delete storedAll[id];
    }
    const payload = Object.fromEntries(
      Object.entries(storedAll).map(([id, map]) => [id, Object.fromEntries(map)]),
    );
    void writeFile(JSON.stringify(payload));
  },
};

const drafts = core.createComposerDrafts(storage, { writeDelayMs: 500 });

export const { getDraft, setDraft, subscribe, scopeToUser } = drafts;

export function useComposerDraft(chatId: string | undefined): string {
  return core.useComposerDraft(
    drafts,
    useChatStore((state) => state.currentUserId),
    chatId,
  );
}
