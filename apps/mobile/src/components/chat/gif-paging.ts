import { Effect } from 'effect';

import { gifsAvailability, setGifsAvailability } from '@/lib/gifs';
import { createGifsApi, GifsApiError, type GifPage, type GifsApi } from '@/lib/gifs-api';

export const fetchGifPage = (input: {
  query: string;
  pos: string | undefined;
  client: { searchGifs: GifsApi['searchGifs']; trendingGifs: GifsApi['trendingGifs'] };
  signal: AbortSignal;
}): Promise<GifPage> => Effect.runPromise(fetchGifPageEffect(input));

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

/** Probes once per session: `false` after a 501, `true` once the provider
 *  answers; a network error keeps it unknown so an outage hides nothing. */
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
