import { Image } from 'expo-image';
import { Plus, Repeat, Smile, TriangleAlert } from 'lucide-react-native';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { EditorNewItem } from '@/components/stickers/pack-editor';
import { API_URL } from '@/lib/auth';
import { DANGER, FOREGROUND, MUTED_FOREGROUND } from '@/lib/colors';
import { isSameOriginStickerUrl, stickerImageSource, type StickerItem } from '@/lib/stickers';
import { cn } from '@/lib/utils';

export type PackTileSelection =
  { kind: 'saved'; stickerId: string } | { kind: 'fresh'; key: string };

/**
 * A moving file (GIF, video, animated WebP or APNG) keeps its bytes and reports
 * `width: 0, height: 0`, so its first frame is shown with a repeat badge. A
 * failed row reports the same zeros, so the error is checked first.
 */
function isMoving(item: EditorNewItem): boolean {
  return item.width === 0 && item.height === 0;
}

const TILE =
  'items-center justify-center overflow-hidden rounded-[12px] border border-edge bg-surface';

function freshLabel(item: EditorNewItem, position: number): string {
  if (item.error !== undefined) {
    return item.error;
  }
  return item.emoji === '' ? `Sticker ${position}` : item.emoji;
}

function EmojiBadge({ emoji }: { emoji: string }) {
  return (
    <View className="absolute bottom-1 right-1 h-5 w-5 items-center justify-center rounded-full border border-border bg-background">
      {emoji === '' ? (
        <Smile size={11} color={MUTED_FOREGROUND} accessibilityLabel="No emoji" />
      ) : (
        <Text numberOfLines={1} className="text-[11px] text-foreground">
          {emoji}
        </Text>
      )}
    </View>
  );
}

export function PackGrid({
  visibleSaved,
  fresh,
  preparing,
  tile,
  token,
  saving,
  packFull,
  onPickImages,
  onSelect,
}: {
  visibleSaved: StickerItem[];
  fresh: EditorNewItem[];
  preparing: number;
  tile: number;
  token: string | undefined;
  saving: boolean;
  packFull: boolean;
  onPickImages: () => void;
  onSelect: (selection: PackTileSelection) => void;
}) {
  return (
    <View accessibilityLabel="Stickers in this pack" className="flex-row flex-wrap gap-2">
      {visibleSaved.map((sticker, index) => (
        <Pressable
          key={sticker.id}
          accessibilityRole="button"
          accessibilityLabel={sticker.emoji === null ? `Sticker ${index + 1}` : sticker.emoji}
          onPress={() => onSelect({ kind: 'saved', stickerId: sticker.id })}
          className={cn(TILE, 'active:opacity-70')}
          style={{ width: tile, height: tile }}
        >
          {isSameOriginStickerUrl(sticker.url, API_URL) ? (
            <Image
              source={stickerImageSource(sticker.url, API_URL, token)}
              style={{ width: tile - 8, height: tile - 8 }}
              contentFit="contain"
            />
          ) : null}
          {sticker.emoji === null ? null : <EmojiBadge emoji={sticker.emoji} />}
        </Pressable>
      ))}

      {fresh.map((item, index) => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={freshLabel(item, visibleSaved.length + index + 1)}
          onPress={() => onSelect({ kind: 'fresh', key: item.key })}
          className={cn(TILE, item.error === undefined ? undefined : 'border-danger/60')}
          style={{ width: tile, height: tile }}
        >
          {item.error === undefined ? (
            <>
              <Image
                source={{ uri: item.uri }}
                style={{ width: tile - 8, height: tile - 8 }}
                contentFit="contain"
              />
              {isMoving(item) ? (
                <View
                  accessible
                  accessibilityLabel="Moves"
                  className="absolute left-1 top-1 h-[18px] w-[18px] items-center justify-center rounded-[6px] bg-black/85"
                >
                  <Repeat size={11} color={FOREGROUND} />
                </View>
              ) : null}
              <EmojiBadge emoji={item.emoji} />
            </>
          ) : (
            <TriangleAlert size={22} color={DANGER} />
          )}
        </Pressable>
      ))}

      {Array.from({ length: preparing }, (_, index) => (
        <View key={`preparing-${index}`} className={TILE} style={{ width: tile, height: tile }}>
          <ActivityIndicator accessibilityLabel="Preparing" color={MUTED_FOREGROUND} />
        </View>
      ))}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add photos, GIFs or videos"
        disabled={saving || preparing > 0 || packFull}
        onPress={onPickImages}
        className="items-center justify-center gap-1 rounded-[12px] border border-dashed border-border-strong disabled:opacity-60"
        style={{ width: tile, height: tile }}
      >
        <Plus size={22} color={MUTED_FOREGROUND} />
        <Text className="text-[12px] text-muted-foreground">Add</Text>
      </Pressable>
    </View>
  );
}
