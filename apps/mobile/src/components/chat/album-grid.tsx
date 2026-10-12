import type { UiMessage } from '@zilar/chat-core';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAlbumMembers } from '@/components/chat/album-members';
import { isLoadableMediaUrl } from '@/components/chat/attachment-message';
import { LONG_PRESS_MS } from '@/components/chat/message-bubble-decor';
import { useOpenMessageMenu } from '@/components/chat/message-menu-context';
import { Text } from '@/components/ui/text';
import { imageGradient } from '@/lib/image-presets';
import { useMediaSource } from '@/lib/media-source';
import { mobileUploadOf } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';

/** One rendered album tile: its message, id, URL and label. */
interface AlbumPhoto {
  message: UiMessage;
  messageId: string;
  url: string;
  alt: string;
}

const GRID_WIDTH = 240;
const GAP = 2;
const HALF = (GRID_WIDTH - GAP) / 2;
const THIRD = (GRID_WIDTH - 2 * GAP) / 3;
const LARGE_WIDTH = GRID_WIDTH - GAP - THIRD;
const EMPTY_HOSTS: ReadonlySet<string> = new Set();

/**
 * The members' renderable photos, in `index` order, mirroring `photosOf`: a
 * message with an `image`, or with an attachment whose `kind` is `image`. The
 * store's sanitizer downgrades an untrusted host to `kind: 'file'`, so a tile
 * here never loads bytes from a peer's arbitrary host.
 */
export function albumPhotosOf(messages: readonly UiMessage[]): AlbumPhoto[] {
  return messages
    .filter((message) => message.album !== undefined)
    .sort((a, b) => (a.album?.index ?? 0) - (b.album?.index ?? 0))
    .flatMap((message) => {
      if (message.image !== undefined) {
        return [{ message, messageId: message.id, url: message.image.url, alt: 'Photo' }];
      }
      if (message.attachment !== undefined && message.attachment.kind === 'image') {
        return [
          {
            message,
            messageId: message.id,
            url: message.attachment.url,
            alt: message.attachment.name,
          },
        ];
      }
      return [];
    });
}

function AlbumTile({
  chatId,
  photo,
  onPress,
  onRetry,
  style,
  hidden,
}: {
  chatId: string;
  photo: AlbumPhoto;
  onPress: () => void;
  onRetry: ((message: UiMessage) => void) | undefined;
  style: StyleProp<ViewStyle>;
  hidden?: number | undefined;
}) {
  const [broken, setBroken] = useState(false);
  const openMenu = useOpenMessageMenu();
  const longPress =
    openMenu === undefined ? {} : { onLongPress: openMenu, delayLongPress: LONG_PRESS_MS };
  const hosts = useChatStore((state) => state.mediaTrustedHosts) ?? EMPTY_HOSTS;
  const upload = mobileUploadOf(photo.message);
  const failed = photo.message.failed === true || photo.message.status === 'failed';
  const gradient = imageGradient(photo.url);
  const trusted = isLoadableMediaUrl(photo.url, hosts);
  // A local preview (still uploading) wins; a `gradient:` URL is the mock-mode
  // placeholder and is never fetched; otherwise a trusted URL loads directly.
  const localUri = upload.localUri;
  const remote = trusted && gradient === undefined && localUri === undefined && !broken;
  const loaded = useMediaSource(chatId, photo.url, remote);
  const source = localUri !== undefined ? { uri: localUri } : loaded;
  const showTile = gradient !== undefined || localUri !== undefined || remote;

  return (
    <View
      style={style}
      className="relative overflow-hidden rounded-[10px] border border-edge bg-well"
    >
      <Pressable
        accessibilityRole="image"
        accessibilityLabel={`View ${photo.alt}`}
        onPress={onPress}
        className="absolute inset-0"
        {...longPress}
      >
        {gradient !== undefined ? (
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: '100%', height: '100%' }}
          />
        ) : showTile ? (
          <Image
            source={source ?? null}
            accessibilityLabel={photo.alt}
            onError={() => setBroken(true)}
            contentFit="cover"
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <View className="h-full w-full items-center justify-center">
            <Text className="text-[11px] text-muted-foreground">Image unavailable</Text>
          </View>
        )}
        {hidden !== undefined ? (
          <View className="absolute inset-0 items-center justify-center bg-black/55">
            <Text className="text-[20px] font-semibold text-white">+{hidden}</Text>
          </View>
        ) : null}
      </Pressable>
      {failed ? (
        <View className="absolute inset-x-0 bottom-0 flex-row items-center justify-center gap-2 bg-black/60 px-1 py-1">
          <Text className="text-[11px] text-white">Upload failed</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry upload"
            onPress={() => onRetry?.(photo.message)}
          >
            <Text className="text-[11px] font-semibold text-white underline">Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * One album rendered as a Telegram-style grid (T-1271): 2 two columns, 3 one
 * large tile and two stacked, 4 a 2×2, 5+ a 2×2 whose last tile shows `+N` for
 * the hidden remainder. The list row hands the item's grouped members down; a
 * head drawn without them (a lone marker outside the list) renders as an album
 * of one. A tile opens the viewer scoped to the album. The caption is the head
 * message's body, drawn by the bubble under this grid.
 */
export function AlbumGrid({
  message,
  onOpen,
  onRetry,
}: {
  message: UiMessage;
  onOpen?: ((messageId: string, albumIds: readonly string[]) => void) | undefined;
  onRetry?: ((message: UiMessage) => void) | undefined;
}) {
  const provided = useAlbumMembers();
  const photos = albumPhotosOf(provided ?? [message]);
  const ids = photos.map((photo) => photo.messageId);
  const first = photos[0];
  const chatId = message.chatId;

  if (photos.length === 0 || first === undefined) {
    return null;
  }
  const tile = (photo: AlbumPhoto, style: StyleProp<ViewStyle>, hidden?: number) => (
    <AlbumTile
      key={photo.messageId}
      chatId={chatId}
      photo={photo}
      onPress={() => onOpen?.(photo.messageId, ids)}
      onRetry={onRetry}
      style={style}
      {...(hidden === undefined ? {} : { hidden })}
    />
  );

  if (photos.length === 1) {
    return <View>{tile(first, { width: 200, height: 150 })}</View>;
  }
  if (photos.length === 2) {
    return (
      <View style={{ width: GRID_WIDTH, flexDirection: 'row', gap: GAP }}>
        {photos.map((photo) => tile(photo, { width: HALF, height: HALF }))}
      </View>
    );
  }
  if (photos.length === 3) {
    const [large, top, bottom] = photos;
    return (
      <View style={{ width: GRID_WIDTH, height: GRID_WIDTH, flexDirection: 'row', gap: GAP }}>
        {large !== undefined && tile(large, { width: LARGE_WIDTH, height: GRID_WIDTH })}
        <View style={{ flex: 1, gap: GAP }}>
          {top !== undefined && tile(top, { flex: 1 })}
          {bottom !== undefined && tile(bottom, { flex: 1 })}
        </View>
      </View>
    );
  }
  const shown = photos.slice(0, 4);
  const total = Math.max(message.album?.count ?? 0, photos.length);
  const hidden = photos.length > 4 ? total - 4 : undefined;
  return (
    <View style={{ width: GRID_WIDTH, flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
      {shown.map((photo, index) =>
        tile(
          photo,
          { width: HALF, height: HALF },
          hidden !== undefined && index === shown.length - 1 ? hidden : undefined,
        ),
      )}
    </View>
  );
}
