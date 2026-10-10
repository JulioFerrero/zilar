import { ImagePlus, X } from 'lucide-react-native';
import { Image as RNImage, Pressable, View } from 'react-native';

import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { FOREGROUND, ICON } from '@/lib/colors';
import { isSameOriginStickerUrl, stickerImageSource, type StickerItem } from '@/lib/stickers';

/**
 * The saved stickers grid plus its notes. Rendered inside the screen's
 * stickers section, so it returns a fragment and the section spacing lives
 * in the route.
 */
export function PackSavedGrid({
  count,
  visibleSaved,
  tile,
  token,
  saving,
  preparing,
  packFull,
  skippedNote,
  packId,
  freshCount,
  onPickImages,
  onRemoveSaved,
}: {
  count: number;
  visibleSaved: StickerItem[];
  tile: number;
  token: string | undefined;
  saving: boolean;
  preparing: number;
  packFull: boolean;
  skippedNote: boolean;
  packId: string | undefined;
  freshCount: number;
  onPickImages: () => void;
  onRemoveSaved: (stickerId: string) => void;
}) {
  return (
    <>
      <View className="flex-row items-baseline justify-between">
        <Text className="text-[16px] font-semibold text-foreground">Stickers</Text>
        <Text className="text-[13px] text-muted-foreground" numberOfLines={1}>
          {count} / 120
        </Text>
      </View>
      <View accessibilityLabel="Stickers in this pack" className="flex-row flex-wrap gap-2">
        {visibleSaved.map((sticker) => (
          <View
            key={sticker.id}
            className="items-center justify-center rounded-[10px] border border-border bg-surface p-1"
            style={{ width: tile, height: tile }}
          >
            {isSameOriginStickerUrl(sticker.url, API_URL) ? (
              <RNImage
                source={stickerImageSource(sticker.url, API_URL, token)}
                style={{ width: tile - 8, height: tile - 8 }}
                resizeMode="contain"
              />
            ) : null}
            {sticker.emoji !== null ? (
              <Text className="absolute bottom-0.5 left-1 text-[11px] text-muted-foreground">
                {sticker.emoji}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove sticker"
              disabled={saving}
              hitSlop={10}
              onPress={() => onRemoveSaved(sticker.id)}
              className="absolute right-0.5 top-0.5 h-6 w-6 items-center justify-center rounded-full bg-black/70 active:opacity-70 disabled:opacity-60"
            >
              <X size={12} color={FOREGROUND} />
            </Pressable>
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add sticker images"
          disabled={saving || preparing > 0 || packFull}
          onPress={onPickImages}
          className="items-center justify-center gap-1 rounded-[10px] border border-dashed border-border-strong bg-well disabled:opacity-60"
          style={{ width: tile, height: tile }}
        >
          <ImagePlus size={22} color={ICON} />
          <Text className="text-[12px] text-muted-foreground">Add</Text>
        </Pressable>
      </View>
      {packId === undefined && visibleSaved.length === 0 && freshCount === 0 ? (
        <Text className="text-[13px] text-muted-foreground">
          Pick PNG, JPEG, WebP or GIF images. Each is resized to fit 512 px.
        </Text>
      ) : null}
      {packFull ? (
        <Text className="text-[13px] text-muted-foreground">
          This pack is full. A pack holds up to 120 stickers.
        </Text>
      ) : null}
      {skippedNote ? (
        <Text className="text-[13px] text-muted-foreground">
          Only 120 stickers fit in a pack. Extra images were skipped.
        </Text>
      ) : null}
      {preparing > 0 ? (
        <StateMessage
          kind="loading"
          size="inline"
          title={preparing === 1 ? 'Preparing 1 image…' : `Preparing ${preparing} images…`}
        />
      ) : null}
    </>
  );
}
