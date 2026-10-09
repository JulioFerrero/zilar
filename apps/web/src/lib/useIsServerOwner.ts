import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { getIntegrationsStatus } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useQuery } from '@/lib/effect/use-query';

/**
 * Whether the signed-in user is the server owner (T-0162). The owner is
 * the user with the earliest `createdAt`; `GET /api/settings/integrations`
 * answers 200 for the owner and the same 404 as an unknown route for
 * everyone else, so 200 means owner and 404 (or any error) means not.
 *
 * The answer is fetched once per session and cached in module state, so
 * every consumer (menu, stickers page, import dialog) shares one request.
 * Starts as not-owner and only switches on after the 200 — never show an
 * owner-only entry optimistically.
 */
let cached: boolean | undefined;

export function useIsServerOwner(): boolean {
  // The query runs once per mount, or not at all when the answer is cached.
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
    // 404 (not the owner) and any error both read as not-owner: the
    // endpoint reveals nothing beyond the status either way.
    Effect.catchTag('ApiFailure', () => Effect.succeed(false)),
    Effect.tap((next) =>
      Effect.sync(() => {
        cached = next;
      }),
    ),
  );

/** Forgets the cached owner answer (tests only). */
export function resetIsServerOwnerCache(): void {
  cached = undefined;
}
