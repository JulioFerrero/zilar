import type { UiMessage } from '@zilar/chat-core';
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

export function useMessageSelection({
  chatId,
  storeApi,
  setForwarding,
}: {
  chatId: string;
  storeApi: ReturnType<typeof useChatStoreApi>;
  setForwarding: Dispatch<SetStateAction<UiMessage[] | null>>;
}) {
  // The ids checked in select mode; null means not selecting. Reset on chat change so a selection never leaks.
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [selectionChatId, setSelectionChatId] = useState(chatId);
  if (selectionChatId !== chatId) {
    setSelectionChatId(chatId);
    setSelectedIds(null);
  }

  const startSelect = useCallback((message: UiMessage): void => {
    setSelectedIds([message.id]);
  }, []);

  const toggleSelect = useCallback((message: UiMessage): void => {
    setSelectedIds((current) => {
      if (current === null) {
        return current;
      }
      return current.includes(message.id)
        ? current.filter((id) => id !== message.id)
        : [...current, message.id];
    });
  }, []);

  const selection = useMemo(
    () => ({ ids: new Set(selectedIds ?? []), onToggle: toggleSelect, onStart: startSelect }),
    [selectedIds, toggleSelect, startSelect],
  );

  const forwardSelected = (): void => {
    if (selectedIds === null) {
      return;
    }
    const ids = new Set(selectedIds);
    setForwarding(
      storeApi
        .getState()
        .messages(chatId)
        .filter((message) => ids.has(message.id)),
    );
    setSelectedIds(null);
  };

  return { selectedIds, setSelectedIds, selection, forwardSelected };
}
