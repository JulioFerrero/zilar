import { Image } from 'expo-image';
import { Camera } from 'lucide-react-native';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { formatDuration } from '@zilar/chat-core';

import { Text } from '@/components/ui/text';
import type { GalleryAsset } from '@/lib/attachment-picker';
import { ICON } from '@/lib/colors';
import { primaryKey } from '@/lib/depth';

/** A grid cell: the live camera tile first, then one recent asset. */
type GalleryCell = { kind: 'camera' } | { kind: 'asset'; asset: GalleryAsset };

/**
 * The Gallery tab's 3-column grid (T-1320): the camera tile first, then the
 * recent photos and videos, paged as the user scrolls. A video shows its
 * duration; a selected tile shows its position in the pick order in a round
 * accent circle, like Telegram.
 */
export function GalleryGrid({
  assets,
  selected,
  busy,
  hasMore,
  onToggle,
  onCamera,
  onLoadMore,
}: {
  assets: readonly GalleryAsset[];
  /** Selected asset ids, in pick order. */
  selected: readonly string[];
  busy: boolean;
  hasMore: boolean;
  onToggle: (id: string) => void;
  onCamera: () => void;
  onLoadMore: () => void;
}) {
  const cells: GalleryCell[] = [
    { kind: 'camera' },
    ...assets.map((asset) => ({ kind: 'asset' as const, asset })),
  ];
  return (
    <FlatList
      data={cells}
      keyExtractor={(cell) => (cell.kind === 'camera' ? 'camera' : cell.asset.id)}
      numColumns={3}
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (hasMore) {
          onLoadMore();
        }
      }}
      contentContainerStyle={{ paddingBottom: 8 }}
      ListFooterComponent={
        hasMore ? (
          <ActivityIndicator accessibilityLabel="Loading more photos" className="py-3" />
        ) : null
      }
      renderItem={({ item }) =>
        item.kind === 'camera' ? (
          <View style={{ width: '33.333%', padding: 1.5 }}>
            <CameraCell busy={busy} onPress={onCamera} />
          </View>
        ) : (
          <View style={{ width: '33.333%', padding: 1.5 }}>
            <AssetCell
              asset={item.asset}
              selectedIndex={selected.indexOf(item.asset.id)}
              onPress={() => onToggle(item.asset.id)}
            />
          </View>
        )
      }
    />
  );
}

function CameraCell({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Take a photo"
      disabled={busy}
      onPress={onPress}
      style={{ aspectRatio: 1 }}
      className="items-center justify-center rounded-[6px] bg-surface-raised active:opacity-80 disabled:opacity-60"
    >
      <Camera size={28} color={ICON} />
      <Text className="mt-1 text-[12px] text-muted-foreground">Camera</Text>
    </Pressable>
  );
}

function AssetCell({
  asset,
  selectedIndex,
  onPress,
}: {
  asset: GalleryAsset;
  selectedIndex: number;
  onPress: () => void;
}) {
  const selected = selectedIndex >= 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={asset.mediaType === 'video' ? 'Video' : 'Photo'}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ aspectRatio: 1 }}
      className="overflow-hidden rounded-[6px]"
    >
      <Image
        source={{ uri: asset.uri }}
        contentFit="cover"
        accessibilityLabel={asset.filename}
        style={{ width: '100%', height: '100%' }}
      />
      {asset.mediaType === 'video' && asset.duration > 0 ? (
        <View className="absolute bottom-1 right-1 rounded-[4px] bg-black/60 px-1 py-0.5">
          <Text className="text-[11px] text-white">
            {formatDuration(asset.duration * 1000, { hours: true })}
          </Text>
        </View>
      ) : null}
      <View
        key={selected ? 'on' : 'off'}
        className="absolute right-1 top-1 h-5 w-5 items-center justify-center rounded-full border"
        style={selected ? primaryKey : { borderColor: 'rgba(255,255,255,0.85)' }}
      >
        {selected ? (
          <Text className="text-[11px] font-semibold" style={{ color: '#0a0a0a' }}>
            {selectedIndex + 1}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
