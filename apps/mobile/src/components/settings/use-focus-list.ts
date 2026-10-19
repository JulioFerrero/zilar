import { Deferred, Effect } from 'effect';
import { useFocusEffect } from 'expo-router';
import { type Dispatch, type SetStateAction, useCallback, useState } from 'react';

import { useAction } from '@/lib/effect/use-action';

type PageStatus = 'loading' | 'ready' | 'error';

export type FocusList<T, E = string> = {
  readonly data: T | undefined;
  readonly setData: Dispatch<SetStateAction<T | undefined>>;
  readonly status: PageStatus;
  readonly error: E | undefined;
  readonly setError: (error: E | undefined) => void;
  readonly refreshing: boolean;
  readonly reload: () => Promise<void>;
  readonly refresh: () => Promise<void>;
};

/**
 * The one list a settings screen reloads on focus: `data` is the screen's own
 * payload, `status` and `error` drive its states, and `refresh` backs
 * pull-to-refresh. A failed background refresh keeps the rows.
 */
export function useFocusList<T, E = string>(load: () => Effect.Effect<T, E>): FocusList<T, E> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [error, setError] = useState<E | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);

  // A new load replaces one still running (the focus refresh and Retry).
  const [, runLoad] = useAction<Deferred.Deferred<void>, void, never>(
    (settled) =>
      Effect.sync(() => {
        // A refresh with rows on screen keeps them: the spinner is only for a screen
        // with nothing to show yet.
        setStatus((current) => (current === 'ready' ? current : 'loading'));
        setError(undefined);
      }).pipe(
        Effect.andThen(load()),
        Effect.tap((value) =>
          Effect.sync(() => {
            setData(value);
            setStatus('ready');
            setRefreshing(false);
          }),
        ),
        Effect.catch((failure) =>
          Effect.sync(() => {
            setRefreshing(false);
            // A failed background refresh keeps the rows; the next focus retries.
            if (status === 'ready') {
              return;
            }
            setError(failure);
            setStatus('error');
          }),
        ),
        Effect.ensuring(Effect.sync(() => Deferred.doneUnsafe(settled, Effect.void))),
      ),
    { mode: 'replace' },
  );

  const reload = useCallback(() => {
    const settled = Deferred.makeUnsafe<void>();
    runLoad(settled);
    return Effect.runPromise(Deferred.await(settled));
  }, [runLoad]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return {
    data,
    setData,
    status,
    error,
    setError,
    refreshing,
    reload,
    refresh: () => {
      setRefreshing(true);
      return reload();
    },
  };
}
