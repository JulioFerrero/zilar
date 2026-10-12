import { useCallback } from 'react';
import { getDraft, setDraft, useComposerDraft } from '@/lib/composer-drafts';
import { useChatSelector } from '@/store/ChatStoreProvider';

// The draft set aside while a chat's message is edited (T-1170, WUX-3): edit
// mode pre-fills the composer with the message text, and leaving it puts this
// draft back, so editing never consumes the in-progress draft. Entries are
// keyed by user and chat, so one account's stashed text can never be restored
// into another account's composer.
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

/**
 * Entering edit mode: keeps the current draft and shows `text` in its place.
 * A second `beginEdit` for the same chat (the user picked another message to
 * edit without leaving the first) keeps the draft already set aside, so
 * cancelling still restores it instead of the first message's text.
 */
export function beginEdit(chatId: string, text: string): void {
  const key = stashKey(chatId);
  if (!draftsSetAside.has(key)) {
    draftsSetAside.set(key, getDraft(chatId));
  }
  setDraft(chatId, text);
}

/**
 * Leaving edit mode: restores the draft that `beginEdit` set aside. Nothing
 * set aside (a switch dropped the stash) restores nothing, so it never writes
 * the previous account's text — or an empty one — into the current composer.
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

/**
 * The composer's text for one chat (T-1170, WUX-3): the value is the draft
 * stored under `chatId`, so a chat switch or a reload keeps it, and every
 * change writes back through `setDraft`. An empty text deletes the draft, so a
 * send leaves nothing behind.
 */
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
