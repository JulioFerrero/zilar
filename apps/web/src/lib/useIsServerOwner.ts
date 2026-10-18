import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { getIntegrationsStatus } from '@/lib/api';
import { fromApi } from '@zilar/client-core';
import { useQuery } from '@/lib/effect/use-query';

/** The owner is the user with the earliest createdAt: GET /api/settings/integrations answers
 * 200 for the owner and the same 404 as an unknown route otherwise. Cached once per session,
 * and never shown optimistically. */
let cached: boolean | undefined;

export function useIsServerOwner(): boolean {
  const [owner] = useQuery(
    (): Effect.Effect<boolean> =>
      cached === undefined ? ownerFromServer() : Effect.succeed(cached),
    [],
  );
  return AsyncResult.getOrElse(owner, () => false);
}

const ownerFromServer = (): Effect.Effect<boolean> =>
  fromApi(() => getIntegrationsStatus()).pipe(
    Effect.as(true),
    // 404 (not the owner) and any error both read as not-owner; the endpoint reveals nothing.
    Effect.catchTag('ApiFailure', () => Effect.succeed(false)),
    Effect.tap((next) =>
      Effect.sync(() => {
        cached = next;
      }),
    ),
  );

export function resetIsServerOwnerCache(): void {
  cached = undefined;
}
