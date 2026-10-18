import { useCallback, useState } from 'react';

import { setDraft, useComposerDraft } from '@/lib/composer-drafts';

// The composer's text for one chat: the chat's stored draft, so leaving and returning keeps it, and every change writes back through `setDraft` (empty deletes it). A composer with no chat id keeps its text locally.
export function useDraftText(chatId: string | undefined): [string, (next: string) => void] {
  const stored = useComposerDraft(chatId);
  const [local, setLocal] = useState('');
  const setValue = useCallback(
    (next: string): void => {
      if (chatId === undefined) {
        setLocal(next);
        return;
      }
      setDraft(chatId, next);
    },
    [chatId],
  );
  return chatId === undefined ? [local, setValue] : [stored, setValue];
}
