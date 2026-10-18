import { useContactRequestsPoll } from '@zilar/client-core';
import { Effect } from 'effect';
import { listContactRequests, type ContactRequestView } from '@/lib/api';
import { onForeground } from '@/lib/foreground';

const list = (): Promise<ContactRequestView[]> =>
  Effect.runPromise(Effect.promise(listContactRequests).pipe(Effect.map((page) => page.incoming)));

/** The incoming contact requests shown as rows; `reload` refreshes at once. */
export function useContactRequests(enabled: boolean): {
  requests: ContactRequestView[];
  reload: () => void;
} {
  return useContactRequestsPoll(list, enabled, onForeground);
}
