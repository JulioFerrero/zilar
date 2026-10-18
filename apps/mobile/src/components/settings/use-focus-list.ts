import { Effect } from 'effect';
import { useFocusEffect } from 'expo-router';
import { type Dispatch, type SetStateAction, useCallback, useState } from 'react';

import { useAction } from '@/lib/effect/use-action';

type PageStatus = 'loading' | 'ready' | 'error';

/** What `useFocusList` hands a settings screen. */
export type FocusList<T> = {
  readonly data: T | undefined;
  readonly setData: Dispatch<SetStateAction<T | undefined>>;
  readonly status: PageStatus;
  readonly error: string;
  readonly setError: (message: string) => void;
  readonly refreshing: boolean;
  readonly refresh: () => void;
};

/**
 * The one list a settings screen reloads on focus (T-2057): `data` holds the
 * screen's own payload, `status` and `error` drive its states, and `refresh`
 * backs pull-to-refresh. A failed background refresh after the first success
 * keeps the rows and shows nothing; the first failure shows the error state.
 */
export function useFocusList<T>(load: () => Effect.Effect<T, string>): FocusList<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // A new load replaces one still running (the focus refresh and Retry).
  const [, reload] = useAction<void, void, never>(
    () =>
      Effect.sync(() => {
        // A refresh with rows on screen keeps them: the spinner is only for a
        // screen with nothing to show yet (T-1906).
        setStatus((current) => (current === 'ready' ? current : 'loading'));
        setError('');
      }).pipe(
        Effect.andThen(load()),
        Effect.tap((value) =>
          Effect.sync(() => {
            setData(value);
            setStatus('ready');
            setRefreshing(false);
          }),
        ),
        Effect.catch((message: string) =>
          Effect.sync(() => {
            setRefreshing(false);
            // A failed background refresh keeps the rows; the next focus retries.
            if (status === 'ready') {
              return;
            }
            setError(message);
            setStatus('error');
          }),
        ),
      ),
    { mode: 'replace' },
  );

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
    refresh: () => {
      setRefreshing(true);
      reload();
    },
  };
}
