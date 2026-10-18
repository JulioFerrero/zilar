import { useContactRequestsPoll } from '@zilar/client-core';
import { Effect } from 'effect';

import type { ContactRequestView, ContactsApi } from './contacts-api';
import { onForeground } from './foreground';

const list = (api: ContactsApi): Promise<ContactRequestView[]> =>
  Effect.runPromise(
    Effect.promise(() => api.listContactRequests()).pipe(Effect.map((page) => page.incoming)),
  );

/** The incoming contact requests shown as rows; `reload` refreshes at once. */
export function useContactRequests(
  api: ContactsApi,
  enabled: boolean,
): {
  requests: ContactRequestView[];
  reload: () => void;
} {
  return useContactRequestsPoll(() => list(api), enabled, onForeground);
}
