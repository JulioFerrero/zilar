import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import { ScrollView, View, Pressable } from 'react-native';
import { SearchField } from '@/components/ui/search-field';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { interruptFiber, useGifSearch } from '@zilar/client-core';
import { type GifItem } from '@zilar/chat-core';
import { GIF_ATTRIBUTION, isLoadableGifPreviewUrl } from '@/lib/gifs';
import { apiCall } from '@/lib/effect/api-client';
import { makeGifsApi, type GifsApi } from '@/lib/gifs-api';
import { getSessionToken } from '@/lib/session-token';
import { realApiTransport } from '@/lib/use-mockable-api';
import { Image } from 'expo-image';
import { API_URL } from '@/lib/auth';

const CELL_ASPECT = 4 / 3;

export const defaultGifsApi = (): GifsApi =>
  makeGifsApi(apiCall(realApiTransport), realApiTransport);

/** Only same-origin proxy URLs preview inline; anything else shows a
 *  placeholder tile, so the device never fetches it. */
function isPanelGifUrl(url: string, apiUrl: string): boolean {
  return isLoadableGifPreviewUrl(url, apiUrl);
}

function GifCell({
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
        recyclingKey={item.url}
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

export type GifPanelProps = {
  open: boolean;
  api?: GifsApi | undefined;
  onPick: (gif: GifItem) => void;
};

export function GifPanel({ open, api, onPick }: GifPanelProps) {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [client] = useState<GifsApi>(() => api ?? defaultGifsApi());
  const { query, setQuery, items, loading, loadingMore, failure, loadMore, retry } = useGifSearch(
    client,
    { enabled: open },
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const fiber = Effect.runFork(
      Effect.tryPromise({ try: () => getSessionToken(), catch: (error) => error }).pipe(
        Effect.match({
          onFailure: () => undefined,
          onSuccess: (value) => setToken(value),
        }),
      ),
    );
    return () => interruptFiber(fiber);
  }, [open]);

  if (!open) {
    return null;
  }

  const rateLimited = failure === 'rate_limited';
  const error =
    failure === undefined
      ? undefined
      : rateLimited
        ? 'Too many GIF searches. Try again in a moment.'
        : 'Could not load GIFs. Try again.';

  return (
    <View className="flex min-h-0 flex-1 flex-col">
      <View className="p-2">
        <SearchField
          value={query}
          onChangeText={setQuery}
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
              onPress: retry,
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
              if (distance < 300) {
                loadMore();
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
