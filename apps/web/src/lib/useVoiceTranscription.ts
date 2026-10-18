import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { getVoiceTranscriptionStatus } from '@/lib/api';
import { fromApi } from '@zilar/client-core';
import { useQuery } from '@/lib/effect/use-query';

/** Whether voice transcription is enabled on this server, fetched once and cached; starts
 * as disabled and only switches on after the server says so. */
let cached: boolean | undefined;

export function useVoiceTranscriptionEnabled(): boolean {
  // The query runs once per mount, or not at all when the answer is cached.
  const [enabled] = useQuery(
    (): Effect.Effect<boolean> =>
      cached === undefined ? enabledFromServer() : Effect.succeed(cached),
    [],
  );
  return AsyncResult.getOrElse(enabled, () => false);
}

const enabledFromServer = (): Effect.Effect<boolean> =>
  fromApi(() => getVoiceTranscriptionStatus()).pipe(
    Effect.map((status) => status.enabled),
    // Any failure reads as disabled: the control simply stays hidden.
    Effect.catchTag('ApiFailure', () => Effect.succeed(false)),
    Effect.tap((next) =>
      Effect.sync(() => {
        cached = next;
      }),
    ),
  );

export function resetVoiceTranscriptionCache(): void {
  cached = undefined;
}
