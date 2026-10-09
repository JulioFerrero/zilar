import { Effect } from 'effect';
import { useEffect } from 'react';
import { listChatFolders } from './api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

/** Syncs chat folders from the server into the store (T-0237). */
export function useChatFolders(): void {
  const storeApi = useChatStoreApi();
  // A new sync replaces one still in flight (the newest answer wins).
  const [, sync, controls] = useAction<void, void, never>(
    () =>
      fromApi(() => listChatFolders()).pipe(
        Effect.matchEffect({
          onSuccess: (folders) => Effect.sync(() => storeApi.getState().setFolders(folders)),
          // Keep the current list; a retry happens on next focus.
          onFailure: () => Effect.void,
        }),
      ),
    { mode: 'replace' },
  );

  useEffect(() => {
    const onFocus = (): void => {
      sync();
    };
    sync();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      controls.interrupt();
    };
  }, [storeApi, sync, controls]);
}
