import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useAction } from '@/lib/effect/use-action';
import type { ContactRequestView, ContactsApi } from './contacts-api';

/**
 * The incoming contact requests the chat list shows as rows (T-1336). The
 * mobile twin of web's `useContactRequests`: it loads once, again every 60
 * seconds, and every time the app returns to the foreground
 * (`use-client-version.ts` uses the same AppState seam; the requests screen
 * reloads on focus instead, `apps/mobile/src/app/settings/requests.tsx`). A
 * failed call keeps the previous list.
 */
const REFRESH_MS = 60 * 1000;

export function useContactRequests(
  api: ContactsApi,
  enabled: boolean,
): {
  requests: ContactRequestView[];
  reload: () => void;
} {
  const [requests, setRequests] = useState<ContactRequestView[]>([]);

  // `useAction` runs the latest producer, so closing over `api` is enough: a new
  // mock/real factory is picked up without rebuilding the action.
  const [, reload] = useAction<void, void, never>(
    () =>
      Effect.tryPromise({
        try: () => api.listContactRequests(),
        catch: (cause) => cause,
      }).pipe(
        Effect.tap((list) => Effect.sync(() => setRequests(list.incoming))),
        Effect.ignore,
      ),
    { mode: 'replace' },
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    reload();
    const interval = setInterval(reload, REFRESH_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        reload();
      }
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [enabled, reload]);

  return { requests, reload };
}
