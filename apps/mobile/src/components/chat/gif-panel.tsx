import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { SearchField } from '@/components/ui/search-field';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { interruptFiber } from '@/lib/effect/timers';
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

function runUntilCleanup(effect: Effect.Effect<void>): () => void {
  const fiber = Effect.runFork(effect);
  return () => {
    interruptFiber(fiber);
  };
}

function cancelWait(fiber: Fiber.Fiber<void> | undefined): void {
  interruptFiber(fiber);
}

export type GifPanelProps = {
  open: boolean;
  api?: GifsApi | undefined;
  onPick: (gif: GifItem) => void;
};

export function GifPanel({ open, api, onPick }: GifPanelProps) {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GifItem[]>([]);
  const [nextPos, setNextPos] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [rateLimited, setRateLimited] = useState(false);
  const [client] = useState<GifsApi>(() => api ?? createGifsApi());
  const inflight = useRef<AbortController | undefined>(undefined);
  const debounceWait = useRef<Fiber.Fiber<void> | undefined>(undefined);
  // A ref set before the fetch starts, so a second scroll event cannot fire an
  // overlapping page load; state sets are async and would race.
  const loadingMoreRef = useRef(false);
  const queryRef = useRef('');

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
    [client],
  );

  // The first load fires from a later tick, never synchronously in the effect
  // body (the `set-state-in-effect` rule); keystrokes debounce through the timer.
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
    stops.push(
      runUntilCleanup(
        Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => load('', undefined, false)))),
      ),
    );
    return () => {
      stops.forEach((stop) => stop());
      inflight.current?.abort();
      cancelWait(debounceWait.current);
      debounceWait.current = undefined;
    };
  }, [open, load]);

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
