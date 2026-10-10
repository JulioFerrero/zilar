import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { isLoadableGifPreviewUrl, type GifItem } from '@/lib/gifs';

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
