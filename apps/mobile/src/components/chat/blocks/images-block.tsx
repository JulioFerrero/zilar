import type { ImagesBlock as ImagesBlockData } from '@zilar/protocol';
import { Effect } from 'effect';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Text } from '@/components/ui/text';
import { cardMediaUrl, OPEN_FAILED_MESSAGE } from '@/lib/attachment-common';
import { createAttachmentOpener } from '@/lib/attachment-opener';
import { API_URL } from '@/lib/auth';
import { useMediaSource } from '@/lib/media-source';
import { getSessionToken } from '@/lib/session-token';

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
  onOpen: (url: string) => void;
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
        if (url !== undefined) {
          onOpen(url);
        }
      }}
      className="overflow-hidden active:opacity-90"
      style={style}
    >
      {source === undefined || failed ? (
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
 * opens the photo through the attachment opener.
 */
export function ImagesBlock({ block }: { block: ImagesBlockData }) {
  const opener = useMemo(
    () => createAttachmentOpener({ apiUrl: API_URL, getToken: getSessionToken }),
    [],
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const open = (url: string): void => {
    setError(undefined);
    Effect.runFork(
      Effect.tryPromise(() => opener.open(url, 'image')).pipe(
        Effect.match({
          onSuccess: (result) => {
            setError(result.status === 'error' ? result.message : undefined);
          },
          onFailure: () => {
            setError(OPEN_FAILED_MESSAGE);
          },
        }),
      ),
    );
  };
  const grid =
    block.items.length === 1 ? (
      <Tile
        id={block.items[0]}
        style={{ height: SINGLE_HEIGHT, borderRadius: 12 }}
        onOpen={open}
        extra={undefined}
      />
    ) : (
      <Grid items={block.items} extra={block.extra} onOpen={open} />
    );
  return (
    <View className="gap-1.5">
      {grid}
      {error === undefined ? null : (
        <Text accessibilityRole="alert" className="text-[12px] text-[#f87171]">
          {error}
        </Text>
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
  onOpen: (url: string) => void;
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
                onOpen={onOpen}
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
