import { Effect } from 'effect';

import { gifsAvailability, setGifsAvailability } from '@/lib/gifs';
import { createGifsApi, GifsApiError, type GifPage, type GifsApi } from '@/lib/gifs-api';

/**
 * The GIF sheet's pager: given the query and cursor, fetches one page (the
 * trending feed for an empty query, a search otherwise). Kept here (not on
 * the panel) so the request shape is unit-testable in Node (T-0157).
 */
export const fetchGifPage = (input: {
  query: string;
  pos: string | undefined;
  client: { searchGifs: GifsApi['searchGifs']; trendingGifs: GifsApi['trendingGifs'] };
  signal: AbortSignal;
}): Promise<GifPage> => Effect.runPromise(fetchGifPageEffect(input));

// One page as an Effect; a rejected call keeps its own error, unchanged.
export const fetchGifPageEffect = (input: {
  query: string;
  pos: string | undefined;
  client: { searchGifs: GifsApi['searchGifs']; trendingGifs: GifsApi['trendingGifs'] };
  signal: AbortSignal;
}): Effect.Effect<GifPage, unknown> =>
  Effect.tryPromise({
    try: () => {
      const trimmed = input.query.trim();
      return trimmed === ''
        ? input.client.trendingGifs(input.pos, input.signal)
        : input.client.searchGifs(trimmed, input.pos, input.signal);
    },
    catch: (error) => error,
  });

/**
 * Probes GIF availability once per session and remembers the answer: `false`
 * after a 501 `gifs_unavailable`, `true` once the provider answers.
 * Network errors keep the answer unknown (the tab stays, the panel shows
 * Retry) so a transient outage does not permanently hide the tab. Mirrors
 * web's `probeGifsAvailability`.
 */
export const probeGifsAvailability = (api?: GifsApi): Promise<boolean> =>
  Effect.runPromise(probeGifsAvailabilityEffect(api));

function probeGifsAvailabilityEffect(api?: GifsApi): Effect.Effect<boolean> {
  const cached = gifsAvailability();
  if (cached !== undefined) {
    return Effect.succeed(cached);
  }
  return Effect.tryPromise({
    try: () => (api ?? createGifsApi()).trendingGifs(undefined, undefined),
    catch: (error) => error,
  }).pipe(
    Effect.andThen(
      Effect.sync(() => {
        setGifsAvailability(true);
        return true;
      }),
    ),
    Effect.catch((error) =>
      error instanceof GifsApiError && error.code === 'gifs_unavailable'
        ? Effect.sync(() => {
            setGifsAvailability(false);
            return false;
          })
        : Effect.succeed(true),
    ),
  );
}
