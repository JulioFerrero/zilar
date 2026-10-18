import { useCallback } from 'react';
import { getDraft, setDraft, useComposerDraft } from '@/lib/composer-drafts';
import { useChatSelector } from '@/store/ChatStoreProvider';

// The draft set aside while a chat's message is edited (WUX-3): edit mode
// pre-fills the composer, and leaving it restores this draft, so editing never
// consumes the in-progress draft. Entries are keyed by user and chat, so one
// account's stashed text can never reach another account's composer.
const draftsSetAside = new Map<string, string>();
let setAsideUserId = '';

// A different signed-in user starts from an empty stash: the old account's
// entries are dropped so they can never collide with the new account's keys.
function scopeSetAside(userId: string): void {
  if (userId !== setAsideUserId) {
    setAsideUserId = userId;
    draftsSetAside.clear();
  }
}

function stashKey(chatId: string): string {
  return `${setAsideUserId}:${chatId}`;
}

export function beginEdit(chatId: string, text: string): void {
  const key = stashKey(chatId);
  if (!draftsSetAside.has(key)) {
    draftsSetAside.set(key, getDraft(chatId));
  }
  setDraft(chatId, text);
}

/**
 * Nothing set aside (a switch dropped the stash) restores nothing, so it never
 * writes the previous account's text — or an empty one — into the composer.
 */
export function endEdit(chatId: string): void {
  const key = stashKey(chatId);
  if (!draftsSetAside.has(key)) {
    return;
  }
  const kept = draftsSetAside.get(key) ?? '';
  draftsSetAside.delete(key);
  setDraft(chatId, kept);
}

export function useDraftValue(chatId: string): [string, (next: string) => void] {
  // Scope the edit stash to the signed-in user (the same id `composer-drafts`
  // uses) before the composer can read it.
  const currentUserId = useChatSelector((s) => s.currentUserId);
  scopeSetAside(currentUserId);
  const value = useComposerDraft(chatId);
  const setValue = useCallback(
    (next: string): void => {
      setDraft(chatId, next);
    },
    [chatId],
  );
  return [value, setValue];
}
