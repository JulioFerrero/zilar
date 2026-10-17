import { parseUrl, type ViewerPhoto } from '@zilar/chat-core';
import type { ImagesBlock as ImagesBlockData } from '@zilar/protocol';
import { Image } from 'expo-image';
import { ImageOff } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { AttachmentViewer } from '@/components/chat/attachment-message';
import { Text } from '@/components/ui/text';
import { cardMediaUrl } from '@/lib/attachment-common';
import { API_URL } from '@/lib/auth';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { useMediaSource } from '@/lib/media-source';

// The board's empty tile (`PhoneContent.dc.html:59`).
const PLACEHOLDER = '#181818';
const GAP = 4;
const TILE_HEIGHT = 112;
const SINGLE_HEIGHT = 170;

/**
 * The board's corners: 12 on the grid's outer edges, 6 on the inner ones
 * (`PhoneContent.dc.html:56-59`). A single image spans the full width with all
 * corners 12.
 */
function tileStyle(index: number, count: number): ViewStyle {
  const row = Math.floor(index / 2);
  const lastRow = Math.floor((count - 1) / 2);
  const left = index % 2 === 0;
  const top = row === 0;
  const bottom = row === lastRow;
  return {
    flex: 1,
    height: TILE_HEIGHT,
    borderTopLeftRadius: top && left ? 12 : 6,
    borderTopRightRadius: top && !left ? 12 : 6,
    borderBottomLeftRadius: bottom && left ? 12 : 6,
    borderBottomRightRadius: bottom && !left ? 12 : 6,
  };
}

function Tile({
  id,
  style,
  extra,
  onOpen,
}: {
  id: string;
  style: ViewStyle;
  extra: number | undefined;
  onOpen: () => void;
}) {
  // Card media is not tied to a chat, so the empty chat id is unused: the URL is
  // absolute, and `mediaUrl` passes anything that is not `/upload/` through.
  const url = cardMediaUrl(id);
  const source = useMediaSource('', url ?? '', url !== undefined);
  const [failed, setFailed] = useState(false);
  return (
    <Pressable
      accessibilityRole="image"
      accessibilityLabel="Photo"
      onPress={() => {
        if (url !== undefined && !failed) {
          onOpen();
        }
      }}
      className="overflow-hidden active:opacity-90"
      style={style}
    >
      {failed ? (
        <View
          className="h-full w-full items-center justify-center gap-1.5"
          style={{ backgroundColor: PLACEHOLDER }}
        >
          <ImageOff size={22} color={MUTED_FOREGROUND} />
          <Text className="text-[12px] text-muted-foreground">Photo unavailable</Text>
        </View>
      ) : source === undefined ? (
        <View className="h-full w-full" style={{ backgroundColor: PLACEHOLDER }} />
      ) : (
        <Image
          source={source}
          onError={() => setFailed(true)}
          contentFit="cover"
          style={{ width: '100%', height: '100%' }}
        />
      )}
      {extra === undefined || extra === 0 ? null : (
        <View className="absolute inset-0 items-center justify-center bg-black/55">
          <Text className="text-[20px] font-medium text-[#ededed]">+{extra}</Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * 20 · IMAGES: one to four uploaded photos in a two-column grid, with a `+N`
 * tile when the message carries more (`PhoneContent.dc.html:52-66`). A tap
 * opens the app's photo viewer on that photo.
 */
export function ImagesBlock({ block }: { block: ImagesBlockData }) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const photos = useMemo<ViewerPhoto[]>(
    () =>
      block.items.flatMap((id) => {
        const url = cardMediaUrl(id);
        return url === undefined ? [] : [{ messageId: id, url, alt: 'Photo' }];
      }),
    [block.items],
  );
  const trustedHosts = useMemo<ReadonlySet<string>>(() => {
    const host = parseUrl(API_URL)?.hostname;
    return new Set(host === undefined ? [] : [host.toLowerCase()]);
  }, []);
  const grid =
    block.items.length === 1 ? (
      <Tile
        id={block.items[0]}
        style={{ height: SINGLE_HEIGHT, borderRadius: 12 }}
        onOpen={() => setViewerIndex(0)}
        extra={undefined}
      />
    ) : (
      <Grid items={block.items} extra={block.extra} onOpen={setViewerIndex} />
    );
  return (
    <View className="gap-1.5">
      {grid}
      {viewerIndex === null ? null : (
        <AttachmentViewer
          // Card media aren't `/upload/` URLs, so the viewer's chat-scoped proxy
          // never runs and the empty chat id is unused.
          chatId=""
          photos={photos}
          startIndex={viewerIndex}
          trustedHosts={trustedHosts}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </View>
  );
}

function Grid({
  items,
  extra,
  onOpen,
}: {
  items: string[];
  extra: number | undefined;
  onOpen: (index: number) => void;
}) {
  const rows: string[][] = [];
  for (let index = 0; index < items.length; index += 2) {
    rows.push(items.slice(index, index + 2));
  }
  return (
    <View style={{ gap: GAP }}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} className="flex-row" style={{ gap: GAP }}>
          {row.map((id, column) => {
            const index = rowIndex * 2 + column;
            const last = index === items.length - 1;
            return (
              <Tile
                key={`${id}-${index}`}
                id={id}
                style={tileStyle(index, items.length)}
                onOpen={() => onOpen(index)}
                extra={last && extra !== undefined && extra > 0 ? extra : undefined}
              />
            );
          })}
          {row.length === 1 ? <View className="flex-1" /> : null}
        </View>
      ))}
    </View>
  );
}
