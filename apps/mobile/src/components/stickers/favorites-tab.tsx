import { Star } from 'lucide-react-native';
import { Image, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { StateMessage } from '@/components/ui/state-message';
import { API_URL } from '@/lib/auth';
import { FOREGROUND } from '@/lib/colors';
import { isSameOriginStickerUrl, stickerImageSource, type StickerItem } from '@/lib/stickers';

/** The Favorites tab: the starred stickers grid with their Remove control. */
export function FavoritesTab({
  favorites,
  tile,
  token,
  busy,
  actionError,
  onUnstar,
}: {
  favorites: StickerItem[];
  tile: number;
  token: string | undefined;
  busy: boolean;
  actionError: string;
  onUnstar: (stickerId: string) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-[16px] font-semibold text-foreground">Favorites</Text>
      {actionError !== '' ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {actionError}
        </Text>
      ) : null}
      {favorites.length === 0 ? (
        <StateMessage kind="empty" title="No favorites yet. Starred stickers show up here." />
      ) : (
        <View accessibilityLabel="Favorite stickers" className="flex-row flex-wrap gap-2">
          {favorites.map((sticker) => (
            <View
              key={sticker.id}
              className="items-center justify-center rounded-[10px] border border-border bg-surface p-1"
              style={{ width: tile, height: tile }}
            >
              {isSameOriginStickerUrl(sticker.url, API_URL) ? (
                <Image
                  source={stickerImageSource(sticker.url, API_URL, token)}
                  accessibilityLabel={sticker.emoji ?? 'Sticker'}
                  style={{ width: tile - 8, height: tile - 8 }}
                  resizeMode="contain"
                />
              ) : (
                <Text accessibilityLabel={sticker.emoji ?? 'Sticker'}>{sticker.emoji ?? ''}</Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove favorite"
                disabled={busy}
                hitSlop={10}
                onPress={() => onUnstar(sticker.id)}
                className="absolute right-0.5 top-0.5 h-6 w-6 items-center justify-center rounded-full bg-black/70 active:opacity-70 disabled:opacity-60"
              >
                <Star size={12} color={FOREGROUND} fill={FOREGROUND} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
