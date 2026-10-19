import { GIF_SEARCH_DEBOUNCE_MS, gifsAvailability, setGifsAvailability } from '@zilar/chat-core';
import { Effect, type Fiber } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiFailure } from './errors';
import type { GifPage } from './stickers-api';
import { interruptFiber } from './use-delayed';

export type GifSearchFailure = 'unavailable' | 'rate_limited' | 'error';

export type TrendingGifs<T> = (pos?: string, signal?: AbortSignal) => Promise<GifPage<T>>;

export interface GifSearchClient<T> {
  searchGifs: (query: string, pos?: string, signal?: AbortSignal) => Promise<GifPage<T>>;
  trendingGifs: TrendingGifs<T>;
}

export interface GifSearchOptions {
  enabled: boolean;
}

export interface GifSearchState<T> {
  query: string;
  setQuery: (query: string) => void;
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  failure: GifSearchFailure | undefined;
  loadMore: () => void;
  retry: () => void;
}

/** Shared GIF search: trending for a blank query, 300 ms debounce, latest query wins. */
export function useGifSearch<T>(
  client: GifSearchClient<T>,
  options: GifSearchOptions,
): GifSearchState<T> {
  const { enabled } = options;
  const { searchGifs, trendingGifs } = client;
  const [query, setQueryState] = useState('');
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<GifSearchFailure | undefined>(undefined);

  const inflight = useRef<AbortController | undefined>(undefined);
  const debounceWait = useRef<Fiber.Fiber<void> | undefined>(undefined);
  // Refs are set before the fetch starts, so a second scroll event cannot fire an
  // overlapping page load; state sets are async and would race.
  const loadingRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const nextPosRef = useRef<string | undefined>(undefined);
  const queryRef = useRef('');

  const setQuery = useCallback((value: string) => {
    queryRef.current = value;
    setQueryState(value);
  }, []);

  const load = useCallback(
    (search: string, pos: string | undefined, append: boolean): void => {
      // A new query aborts the in-flight one, so its late answer never lands.
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      if (append) {
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        // A fresh query must release an aborted append's guard, or infinite scroll stops.
        loadingMoreRef.current = false;
        loadingRef.current = true;
        nextPosRef.current = undefined;
        setLoadingMore(false);
        setLoading(true);
        setFailure(undefined);
        setItems([]);
      }
      const trimmed = search.trim();
      const request = Effect.tryPromise({
        try: () =>
          trimmed === ''
            ? trendingGifs(pos, controller.signal)
            : searchGifs(trimmed, pos, controller.signal),
        catch: toApiFailure,
      });
      Effect.runFork(
        request.pipe(
          Effect.match({
            onSuccess: (page) => {
              if (controller.signal.aborted) {
                return;
              }
              setItems((previous) => (append ? [...previous, ...page.items] : page.items));
              nextPosRef.current = page.nextPos;
              loadingRef.current = false;
              loadingMoreRef.current = false;
              setLoading(false);
              setLoadingMore(false);
            },
            onFailure: (requestError) => {
              if (controller.signal.aborted) {
                return;
              }
              if (requestError.code === 'gifs_unavailable') {
                setGifsAvailability(false);
                setFailure('unavailable');
              } else if (requestError.code === 'rate_limited') {
                setFailure('rate_limited');
              } else {
                setFailure('error');
              }
              loadingRef.current = false;
              loadingMoreRef.current = false;
              setLoading(false);
              setLoadingMore(false);
            },
          }),
        ),
      );
    },
    [searchGifs, trendingGifs],
  );

  // The first load fires from a later tick, never synchronously in the effect
  // body (the `set-state-in-effect` rule).
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const fiber = Effect.runFork(
      Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => load('', undefined, false)))),
    );
    return () => {
      interruptFiber(fiber);
      inflight.current?.abort();
      interruptFiber(debounceWait.current);
      debounceWait.current = undefined;
    };
  }, [enabled, load]);

  // Each keystroke restarts the 300 ms wait. The mount value is skipped because the
  // initial load above already requests trending.
  const lastQuery = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (lastQuery.current === query) {
      return;
    }
    const first = lastQuery.current === undefined;
    lastQuery.current = query;
    if (first) {
      return;
    }
    interruptFiber(debounceWait.current);
    debounceWait.current = Effect.runFork(
      Effect.sleep(GIF_SEARCH_DEBOUNCE_MS).pipe(
        Effect.andThen(
          Effect.sync(() => {
            debounceWait.current = undefined;
            load(query, undefined, false);
          }),
        ),
      ),
    );
    return () => {
      interruptFiber(debounceWait.current);
      debounceWait.current = undefined;
    };
  }, [enabled, query, load]);

  const loadMore = useCallback((): void => {
    const pos = nextPosRef.current;
    if (pos === undefined || loadingRef.current || loadingMoreRef.current) {
      return;
    }
    load(queryRef.current, pos, true);
  }, [load]);

  const retry = useCallback((): void => {
    load(queryRef.current, undefined, false);
  }, [load]);

  return { query, setQuery, items, loading, loadingMore, failure, loadMore, retry };
}

/**
 * Probes once per session: `false` after a 501, `true` once the provider
 * answers; a network error keeps it unknown so an outage hides nothing.
 */
export function probeGifsAvailability<T>(trending: TrendingGifs<T>): Effect.Effect<boolean> {
  return Effect.suspend(() => {
    const cached = gifsAvailability();
    if (cached !== undefined) {
      return Effect.succeed(cached);
    }
    return Effect.tryPromise({
      try: () => trending(undefined, undefined),
      catch: toApiFailure,
    }).pipe(
      Effect.andThen(
        Effect.sync(() => {
          setGifsAvailability(true);
          return true;
        }),
      ),
      Effect.catch((error) =>
        error.code === 'gifs_unavailable'
          ? Effect.sync(() => {
              setGifsAvailability(false);
              return false;
            })
          : Effect.succeed(true),
      ),
    );
  });
}
