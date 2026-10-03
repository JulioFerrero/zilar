import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';
import {
  GIF_ATTRIBUTION,
  GIF_SEARCH_DEBOUNCE_MS,
  gifsAvailability,
  isLoadableGifPreviewUrl,
  setGifsAvailability,
  type GifItem,
} from '@/lib/gifs';
import { createGifsApi, GifsApiError, type GifPage, type GifsApi } from '@/lib/gifs-api';

const CELL_ASPECT = 4 / 3;

/**
 * Whether the panel may show a preview inline: same-origin proxy URLs
 * only. Anything else (a hostile URL, mock `data:` art handled below, ...)
 * shows a placeholder tile, so the device never fetches it.
 */
export function isPanelGifUrl(url: string, apiUrl: string): boolean {
  return isLoadableGifPreviewUrl(url, apiUrl);
}

/** One GIF cell: the preview image with a play badge for videos. */
export function GifCell({
  item,
  token,
  onPick,
}: {
  item: GifItem;
  token: string | undefined;
  onPick: (gif: GifItem) => void;
}) {
  const label = item.title === '' ? 'GIF' : item.title;
  if (!isPanelGifUrl(item.url, API_URL) && !item.url.startsWith('data:image/')) {
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={label}
        className="items-center justify-center rounded-[8px] bg-surface-raised"
        style={{ aspectRatio: CELL_ASPECT }}
      >
        <Text className="text-[26px]">🎞️</Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Send ${label}`}
      onPress={() => onPick(item)}
      className="overflow-hidden rounded-[8px] bg-surface-raised"
      style={{ aspectRatio: CELL_ASPECT }}
    >
      <Image
        source={
          item.url.startsWith('data:image/')
            ? { uri: item.url }
            : {
                uri: item.url,
                ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
              }
        }
        accessibilityLabel={label}
        style={{ width: '100%', height: '100%' }}
        contentFit="cover"
      />
      {item.kind === 'video' ? (
        <View className="absolute right-1 bottom-1 items-center justify-center rounded-full bg-black/60 px-2 py-0.5">
          <Text className="text-[11px] text-white">▶ GIF</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

type GifPanelProps = {
  open: boolean;
  /** Mock mode serves generated placeholders without a server. */
  mockItems?: GifItem[] | undefined;
  /** Injected API client; tests hand a fake, production builds the real one. */
  api?: GifsApi | undefined;
  onPick: (gif: GifItem) => void;
};

type GifSheetProps = GifPanelProps & {
  onClose: () => void;
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
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
      const request = fetchGifPage({ query: trimmed, pos, client, signal: controller.signal });
      void request.then(
        (page) => {
          if (controller.signal.aborted) {
            return;
          }
          setItems((previous) => (append ? [...previous, ...page.items] : page.items));
          setNextPos(page.nextPos);
          setLoading(false);
          loadingMoreRef.current = false;
          setLoadingMore(false);
        },
        (requestError: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          if (requestError instanceof DOMException && requestError.name === 'AbortError') {
            return;
          }
          // The provider is off: remember it for the session so the tab
          // hides (the composer probes this cache), and show Retry here.
          if (requestError instanceof GifsApiError && requestError.code === 'gifs_unavailable') {
            setGifsAvailability(false);
          } else if (requestError instanceof GifsApiError && requestError.code === 'rate_limited') {
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
    let cancelled = false;
    void getSessionToken().then((value) => {
      if (!cancelled) {
        setToken(value);
      }
    });
    if (mockItems === undefined) {
      void Promise.resolve().then(() => {
        if (!cancelled) {
          load('', undefined, false);
        }
      });
    }
    return () => {
      cancelled = true;
      inflight.current?.abort();
      if (debounceTimer.current !== undefined) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = undefined;
      }
    };
  }, [open, mockItems, load]);

  if (!open) {
    return null;
  }

  const scheduleSearch = (search: string): void => {
    if (debounceTimer.current !== undefined) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = undefined;
    }
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = undefined;
      load(search, undefined, false);
    }, GIF_SEARCH_DEBOUNCE_MS);
  };

  return (
    <View className="flex min-h-0 flex-1 flex-col">
      <View className="p-2">
        <TextInput
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            queryRef.current = value;
            scheduleSearch(value);
          }}
          placeholder="Search GIFs"
          placeholderTextColor="#a1a1a1"
          accessibilityLabel="Search GIFs"
          className="w-full rounded-[8px] bg-surface-raised px-3 py-1.5 text-[13px] text-foreground"
        />
      </View>
      {loading ? (
        <View className="h-[180px] items-center justify-center">
          <ActivityIndicator accessibilityLabel="Loading GIFs" />
        </View>
      ) : error !== undefined ? (
        <View className="h-[180px] items-center justify-center gap-2 px-4">
          <Text className="text-center text-[13px] text-muted-foreground">{error}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading GIFs"
            onPress={() => load(queryRef.current, undefined, false)}
            className="rounded-[10px] px-4 py-2 active:bg-surface-raised"
          >
            <Text className="text-[15px] font-semibold text-foreground">Retry</Text>
          </Pressable>
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

/**
 * The GIF sheet's pager: given the query and cursor, fetches one page (the
 * trending feed for an empty query, a search otherwise). Kept here (not on
 * the panel) so the request shape is unit-testable in Node (T-0157).
 */
export async function fetchGifPage(input: {
  query: string;
  pos: string | undefined;
  client: { searchGifs: GifsApi['searchGifs']; trendingGifs: GifsApi['trendingGifs'] };
  signal: AbortSignal;
}): Promise<GifPage> {
  const trimmed = input.query.trim();
  return trimmed === ''
    ? input.client.trendingGifs(input.pos, input.signal)
    : input.client.searchGifs(trimmed, input.pos, input.signal);
}

/**
 * Probes GIF availability once per session and remembers the answer: `false`
 * after a 501 `gifs_unavailable`, `true` once the provider answers.
 * Network errors keep the answer unknown (the tab stays, the panel shows
 * Retry) so a transient outage does not permanently hide the tab. Mirrors
 * web's `probeGifsAvailability`.
 */
export async function probeGifsAvailability(api?: GifsApi): Promise<boolean> {
  const cached = gifsAvailability();
  if (cached !== undefined) {
    return cached;
  }
  try {
    await (api ?? createGifsApi()).trendingGifs(undefined, undefined);
    setGifsAvailability(true);
    return true;
  } catch (error) {
    if (error instanceof GifsApiError && error.code === 'gifs_unavailable') {
      setGifsAvailability(false);
      return false;
    }
    return true;
  }
}

/**
 * The GIF sheet wrapper (the composer renders it next to `StickerPanel`).
 * Kept in this file so the composer imports one GIF module, like stickers.
 */
export function GifSheet({ open, mockItems, api, onPick, onClose }: GifSheetProps) {
  const insets = useSafeAreaInsets();
  if (!open) {
    return null;
  }
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close GIFs"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable
          onPress={() => {}}
          accessibilityRole="menu"
          accessibilityLabel="GIFs"
          className="h-[50%] rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
          <Text
            accessibilityRole="header"
            className="py-2 text-[17px] font-semibold text-foreground"
          >
            GIFs
          </Text>
          <GifPanel open={open} mockItems={mockItems} api={api} onPick={onPick} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
