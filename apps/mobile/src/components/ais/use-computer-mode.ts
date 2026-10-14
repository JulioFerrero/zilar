import { useState } from 'react';
import { Effect } from 'effect';

import type { AisApi, PublicAi } from '@/lib/ais-api';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

import type { ComputerMode } from './computer-picker';
import { describeAisError } from './errors';

/** The raw rejection is kept, not mapped, so `describeAisError` sees it. */
function rawCall<A>(call: () => Promise<A>) {
  return Effect.tryPromise({ try: call, catch: (cause) => ({ cause }) });
}

export interface ComputerModeControls {
  /** The AI's computer mode to show. */
  mode: ComputerMode;
  /** Whether Zilar cloud desks are wired; false until the server says otherwise. */
  cloud: boolean;
  /** A fixed user-facing sentence, or empty. */
  error: string;
  busy: boolean;
  /** Adopts the mode of a freshly loaded AI. */
  adopt: (ai: PublicAi) => void;
  /** Patches the AI's computer mode right away; the choice reverts on failure. */
  change: (mode: ComputerMode) => void;
}

/**
 * T-1425: the AI's computer mode behind the edit screen's picker. It owns the
 * cloud-availability read and the immediate save-and-revert, so the screen
 * stays thin. The server's fresh AI is the source of truth on success; on
 * failure the previous value comes back with a fixed error sentence.
 */
export function useComputerMode(api: AisApi, aiId: string | null): ComputerModeControls {
  const [mode, setMode] = useState<ComputerMode>('off');
  const [error, setError] = useState('');
  // A failed options read keeps the cloud option disabled, the safe default.
  const [cloud, setCloud] = useState(false);

  useQuery(
    () =>
      rawCall(() => api.getComputerOptions()).pipe(
        Effect.tap((options) => Effect.sync(() => setCloud(options.cloud))),
        Effect.catch(() => Effect.sync(() => setCloud(false))),
      ),
    [api],
  );

  const [state, run] = useAction((change: { next: ComputerMode; previous: ComputerMode }) => {
    if (aiId === null || change.next === change.previous) {
      return Effect.void;
    }
    return Effect.sync(() => {
      setMode(change.next);
      setError('');
    }).pipe(
      Effect.andThen(rawCall(() => api.updateAi(aiId, { computerMode: change.next }))),
      Effect.tap((fresh) => Effect.sync(() => setMode(fresh.computerMode ?? 'off'))),
      Effect.asVoid,
      Effect.catch(({ cause }) =>
        Effect.sync(() => {
          setMode(change.previous);
          setError(describeAisError(cause, 'Could not update the computer.').message);
        }),
      ),
    );
  });
  const busy = isWaiting(state);

  const change = (next: ComputerMode): void => {
    if (aiId === null || busy) {
      return;
    }
    run({ next, previous: mode });
  };

  const adopt = (ai: PublicAi): void => {
    setMode(ai.computerMode ?? 'off');
  };

  return { mode, cloud, error, busy, adopt, change };
}
