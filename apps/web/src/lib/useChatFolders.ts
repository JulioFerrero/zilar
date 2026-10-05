import { useEffect } from 'react';
import { listChatFolders } from './api';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

/** Syncs chat folders from the server into the store (T-0237). */
export function useChatFolders(): void {
  const storeApi = useChatStoreApi();

  useEffect(() => {
    let cancelled = false;
    async function sync(): Promise<void> {
      try {
        const folders = await listChatFolders();
        if (!cancelled) {
          storeApi.getState().setFolders(folders);
        }
      } catch {
        // Keep the current list; a retry happens on next focus.
      }
    }
    void sync();
    window.addEventListener('focus', sync);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', sync);
    };
  }, [storeApi]);
}
