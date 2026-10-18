import { createComposerDrafts, useComposerDraft as useShared } from '@zilar/client-core';
import { Effect, Schema } from 'effect';

import { useChatSelector } from '@/store/ChatStoreProvider';

const key = (userId: string): string => `zilar:composerDrafts:${userId}`;
const decodeStoredDrafts = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

const storage = {
  load(userId: string): Map<string, string> {
    try {
      const raw = window.localStorage.getItem(key(userId));
      if (raw === null) return new Map();
      const stored = Effect.runSync(
        Effect.try(() => decodeStoredDrafts(raw)).pipe(Effect.orElseSucceed(() => ({}))),
      );
      return new Map(Object.entries(stored));
    } catch {
      return new Map();
    }
  },
  save(userId: string, drafts: Map<string, string>): void {
    try {
      window.localStorage.setItem(key(userId), JSON.stringify(Object.fromEntries(drafts)));
    } catch {
      // Ignore a full or blocked storage.
    }
  },
};

const drafts = createComposerDrafts(storage, { writeDelayMs: 300 });
export const { getDraft, setDraft, subscribe } = drafts;

export function useComposerDraft(chatId: string): string {
  const userId = useChatSelector((state) => state.currentUserId);
  return useShared(drafts, userId, chatId);
}
