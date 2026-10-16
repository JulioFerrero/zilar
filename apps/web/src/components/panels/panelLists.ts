import { Effect } from 'effect';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { ApiFailure, toApiFailure } from '@/lib/effect/errors';
import { useQuery } from '@/lib/effect/use-query';
import { textOf } from './topic-failure';

export type PanelStatus = 'loading' | 'ready' | 'error';

/**
 * A chat-store action. The store throws an ApiError (mapped as fromApi maps
 * it) or a plain Error whose message is the user-facing sentence, which keeps
 * its text. Any other cause becomes the unknown failure, so `textOf` shows the
 * fixed fallback.
 */
export const storeCall = <A>(call: () => Promise<A>): Effect.Effect<A, ApiFailure> =>
  Effect.tryPromise({
    try: call,
    catch: (cause) =>
      cause instanceof Error && !(cause instanceof ApiError)
        ? new ApiFailure({ status: 0, code: 'store_error', message: cause.message, detail: {} })
        : toApiFailure(cause),
  });

/** The shown state of one loaded list. */
export type ListState<Item> = {
  status: PanelStatus;
  items: Item[];
  message: string;
};

/** One list on the panel: a shown list stays on screen while it reloads, and
 *  `keepReadyOnDrop` decides whether the rows left after a failed re-read stay
 *  visible. */
export function useListLoader<Item, Id>({
  load,
  fallback,
  deps,
  idOf,
  keepReadyOnDrop,
}: {
  load: () => Promise<Item[]>;
  fallback: string;
  deps: ReadonlyArray<unknown>;
  idOf: (item: Item) => Id;
  keepReadyOnDrop: (previous: readonly Item[]) => boolean;
}) {
  const [state, setState] = useState<ListState<Item>>({
    status: 'loading',
    items: [],
    message: '',
  });

  const setFailure = (failure: ApiFailure): void =>
    setState({ status: 'error', items: [], message: textOf(failure, fallback) });

  // `onShown` runs in the same step as the list update, so a row or picker
  // that the update removes has finished its last step.
  const fetch = (onShown: () => void = () => undefined): Effect.Effect<void, ApiFailure> =>
    fromApi(load).pipe(
      Effect.tap((items) =>
        Effect.sync(() => {
          setState({ status: 'ready', items, message: '' });
          onShown();
        }),
      ),
      Effect.asVoid,
    );

  const loadEffect = Effect.sync(() =>
    setState((previous) =>
      previous.status === 'ready' ? previous : { status: 'loading', items: [], message: '' },
    ),
  ).pipe(
    Effect.andThen(fetch()),
    Effect.catchTag('ApiFailure', (failure) => Effect.sync(() => setFailure(failure))),
  );
  const [, refresh] = useQuery(() => loadEffect, deps);

  // The list re-read after an action: a failure shows the list's inline error,
  // and `done` runs in the same step either way.
  const reloadAfter = (done: () => void = () => undefined): Effect.Effect<void> =>
    fetch(done).pipe(
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() => {
          setFailure(failure);
          done();
        }),
      ),
    );

  const dropItem = (id: Id): void =>
    setState((previous) => ({
      status: previous.status === 'ready' && keepReadyOnDrop(previous.items) ? 'ready' : 'error',
      items: previous.items.filter((item) => idOf(item) !== id),
      message: 'Could not refresh the list.',
    }));

  return { state, refresh, fetch, reloadAfter, dropItem };
}

/**
 * Removes one row: the store call, then a re-read of the list. A 404 with
 * `onMissing` runs the "the row may be gone" path instead of failing. A
 * re-read that fails after a successful delete drops the row locally: never
 * show a removed row as if the delete failed.
 */
export function removeRow<Id>({
  call,
  reload,
  drop,
  onMissing,
}: {
  call: (id: Id) => Promise<unknown>;
  reload: () => Effect.Effect<void, ApiFailure>;
  drop: (id: Id) => void;
  onMissing?: () => Effect.Effect<void, ApiFailure>;
}): (id: Id) => Effect.Effect<void, ApiFailure> {
  return (id) =>
    storeCall(() => call(id)).pipe(
      Effect.matchEffect({
        onFailure: (failure: ApiFailure): Effect.Effect<void, ApiFailure> =>
          onMissing !== undefined && failure.status === 404 ? onMissing() : Effect.fail(failure),
        onSuccess: (): Effect.Effect<void> =>
          reload().pipe(Effect.catchTag('ApiFailure', () => Effect.sync(() => drop(id)))),
      }),
    );
}
