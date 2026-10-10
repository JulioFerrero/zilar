import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { SearchField } from '@/components/ui/search-field';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import {
  GIF_ATTRIBUTION,
  GIF_SEARCH_DEBOUNCE_MS,
  setGifsAvailability,
  type GifItem,
} from '@/lib/gifs';
import { createGifsApi, GifsApiError, type GifsApi } from '@/lib/gifs-api';
import { getSessionToken } from '@/lib/session-token';

import { GifCell } from './gif-cells';
import { fetchGifPageEffect } from './gif-paging';

export { GifCell, isPanelGifUrl } from './gif-cells';
export { fetchGifPage, probeGifsAvailability } from './gif-paging';
export { GifSheet } from './gif-panel-sheet';

/**
 * Runs an Effect for as long as the component's effect lasts: the returned
 * cleanup interrupts it (the old `cancelled` flag).
 */
function runUntilCleanup(effect: Effect.Effect<void>): () => void {
  const fiber = Effect.runFork(effect);
  return () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
}

/** Interrupts a debounce wait that is still pending (the old `clearTimeout`). */
function cancelWait(fiber: Fiber.Fiber<void> | undefined): void {
  if (fiber !== undefined) {
    Effect.runFork(Fiber.interrupt(fiber));
  }
}

export type GifPanelProps = {
  open: boolean;
  /** Mock mode serves generated placeholders without a server. */
  mockItems?: GifItem[] | undefined;
  /** Injected API client; tests hand a fake, production builds the real one. */
  api?: GifsApi | undefined;
  onPick: (gif: GifItem) => void;
};

/**
 * The GIFs tab content (T-0148): a search field (debounced 300 ms,
 * cancelling the in-flight request), trending when the query is empty, a
 * 2-column grid of proxy-loaded previews, infinite scroll with the returned
 * `pos` cursor, and the provider attribution. Empty, error-with-retry and
 * rate-limited states included.
 */
export function GifPanel({ open, mockItems, api, onPick }: GifPanelProps) {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GifItem[]>(() => mockItems ?? []);
  const [nextPos, setNextPos] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(mockItems === undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [rateLimited, setRateLimited] = useState(false);
  const [client] = useState<GifsApi>(() => api ?? createGifsApi());
  const inflight = useRef<AbortController | undefined>(undefined);
  const debounceWait = useRef<Fiber.Fiber<void> | undefined>(undefined);
  // The synchronous in-flight guard for infinite scroll (T-0157): a ref set
  // before the fetch starts, so a second scroll event while a page is in
  // flight cannot fire an overlapping page load. `loadingMore` state only
  // mirrors it for the spinner; state sets are async and would race.
  const loadingMoreRef = useRef(false);
  // The latest query for the Retry button and the scroll pager: written in
  // the change handler (an event, never during render) alongside `setQuery`.
  const queryRef = useRef('');

  const load = useCallback(
    (search: string, pos: string | undefined, append: boolean): void => {
      if (mockItems !== undefined) {
        return;
      }
      // A new query supersedes the in-flight one: abort it so its late
      // answer never lands (the guard below drops it anyway).
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      if (append) {
        // Guarded synchronously by `loadingMoreRef`: an append never starts
        // while one is in flight (the scroll handler checks the ref).
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        // A fresh query owns the list now: an append it aborted must not
        // leave the guard stuck, or infinite scroll would never fire again.
        loadingMoreRef.current = false;
        setLoadingMore(false);
        setLoading(true);
        setError(undefined);
        setRateLimited(false);
      }
      const trimmed = search.trim();
      const request = fetchGifPageEffect({
        query: trimmed,
        pos,
        client,
        signal: controller.signal,
      });
      Effect.runFork(
        request.pipe(
          Effect.match({
            onSuccess: (page) => {
              if (controller.signal.aborted) {
                return;
              }
              setItems((previous) => (append ? [...previous, ...page.items] : page.items));
              setNextPos(page.nextPos);
              setLoading(false);
              loadingMoreRef.current = false;
              setLoadingMore(false);
            },
            onFailure: (requestError: unknown) => {
              if (controller.signal.aborted) {
                return;
              }
              if (requestError instanceof DOMException && requestError.name === 'AbortError') {
                return;
              }
              // The provider is off: remember it for the session so the tab
              // hides (the composer probes this cache), and show Retry here.
              if (
                requestError instanceof GifsApiError &&
                requestError.code === 'gifs_unavailable'
              ) {
                setGifsAvailability(false);
              } else if (
                requestError instanceof GifsApiError &&
                requestError.code === 'rate_limited'
              ) {
                setRateLimited(true);
              }
              setError(
                requestError instanceof GifsApiError && requestError.code === 'rate_limited'
                  ? 'Too many GIF searches. Try again in a moment.'
                  : 'Could not load GIFs. Try again.',
              );
              setLoading(false);
              loadingMoreRef.current = false;
              setLoadingMore(false);
            },
          }),
        ),
      );
    },
    [mockItems, client],
  );

  // Trending on open, then debounced search: opening the sheet fires the
  // load from a microtask (never synchronously in the effect, per the
  // `set-state-in-effect` rule); keystrokes debounce through the timer.
  useEffect(() => {
    if (!open) {
      return;
    }
    const stops = [
      runUntilCleanup(
        Effect.tryPromise({ try: () => getSessionToken(), catch: (error) => error }).pipe(
          Effect.match({
            onFailure: () => undefined,
            onSuccess: (value) => setToken(value),
          }),
        ),
      ),
    ];
    if (mockItems === undefined) {
      // The first page fires from a later tick, never synchronously in the
      // effect body (the `set-state-in-effect` rule).
      stops.push(
        runUntilCleanup(
          Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => load('', undefined, false)))),
        ),
      );
    }
    return () => {
      stops.forEach((stop) => stop());
      inflight.current?.abort();
      cancelWait(debounceWait.current);
      debounceWait.current = undefined;
    };
  }, [open, mockItems, load]);

  if (!open) {
    return null;
  }

  const scheduleSearch = (search: string): void => {
    cancelWait(debounceWait.current);
    debounceWait.current = Effect.runFork(
      Effect.sleep(GIF_SEARCH_DEBOUNCE_MS).pipe(
        Effect.andThen(
          Effect.sync(() => {
            debounceWait.current = undefined;
            load(search, undefined, false);
          }),
        ),
      ),
    );
  };

  return (
    <View className="flex min-h-0 flex-1 flex-col">
      <View className="p-2">
        <SearchField
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            queryRef.current = value;
            scheduleSearch(value);
          }}
          placeholder="Search GIFs"
          accessibilityLabel="Search GIFs"
        />
      </View>
      {loading ? (
        <View className="h-[180px] items-center justify-center">
          <StateMessage kind="loading" title="Loading GIFs" />
        </View>
      ) : error !== undefined ? (
        <View className="h-[180px] items-center justify-center gap-2 px-4">
          <StateMessage
            kind="error"
            title={error}
            action={{
              label: 'Retry',
              accessibilityLabel: 'Retry loading GIFs',
              onPress: () => load(queryRef.current, undefined, false),
            }}
          />
          {rateLimited ? (
            <Text className="text-center text-[12px] text-muted-foreground">{GIF_ATTRIBUTION}</Text>
          ) : null}
        </View>
      ) : items.length === 0 ? (
        <View className="h-[180px] items-center justify-center gap-1 px-4">
          <Text className="text-center text-[13px] text-muted-foreground">
            {query.trim() === ''
              ? 'No trending GIFs right now.'
              : 'No GIFs found. Try another search.'}
          </Text>
          <Text className="text-center text-[12px] text-muted-foreground">{GIF_ATTRIBUTION}</Text>
        </View>
      ) : (
        <>
          <ScrollView
            accessibilityLabel="GIFs"
            className="min-h-0 flex-1"
            contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 8 }}
            onScroll={(event) => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
              // The ref guard is synchronous: a second scroll event while a
              // page is in flight never fires an overlapping page load.
              if (
                distance < 300 &&
                nextPos !== undefined &&
                !loadingMoreRef.current &&
                !loading &&
                !loadingMore
              ) {
                load(queryRef.current, nextPos, true);
              }
            }}
            scrollEventThrottle={200}
          >
            {items.map((item) => (
              <View key={item.id} style={{ width: '48%' }}>
                <GifCell item={item} token={token} onPick={onPick} />
              </View>
            ))}
          </ScrollView>
          <View className="flex-row items-center justify-center gap-2 border-t border-edge px-2 py-1">
            <Text className="text-[11px] text-muted-foreground">{GIF_ATTRIBUTION}</Text>
            {loadingMore ? (
              <Text className="text-[11px] text-muted-foreground">Loading more…</Text>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}
