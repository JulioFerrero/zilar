import { useAlbumMembers } from '@zilar/client-core';
import { isLoadableMediaUrl, type UiMessage, withMediaRetry } from '@zilar/chat-core';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { LONG_PRESS_MS } from '@/components/chat/message-bubble-decor';
import { useOpenMessageMenu } from '@/components/chat/message-menu-context';
import { Text } from '@/components/ui/text';
import { imageGradient } from '@/lib/image-presets';
import { useMediaRetry } from '@/lib/media-retry';
import { useMediaSource } from '@/lib/media-source';
import { mobileUploadOf } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';

interface AlbumPhoto {
  message: UiMessage;
  messageId: string;
  url: string;
  alt: string;
  width?: number | undefined;
  height?: number | undefined;
}

const GRID_WIDTH = 240;
const GAP = 2;
const HALF = (GRID_WIDTH - GAP) / 2;
const THIRD = (GRID_WIDTH - 2 * GAP) / 3;
const LARGE_WIDTH = GRID_WIDTH - GAP - THIRD;
const EMPTY_HOSTS: ReadonlySet<string> = new Set();
const FALLBACK_ASPECT_RATIO = 4 / 3;
const MAX_IMAGE_HEIGHT = 320;

/** The members' renderable photos in `index` order; the store downgrades an
 *  untrusted host to a file, so no tile loads bytes from a peer's host. */
export function albumPhotosOf(messages: readonly UiMessage[]): AlbumPhoto[] {
  return messages
    .filter((message) => message.album !== undefined)
    .sort((a, b) => (a.album?.index ?? 0) - (b.album?.index ?? 0))
    .flatMap((message) => {
      if (message.image !== undefined) {
        return [
          {
            message,
            messageId: message.id,
            url: message.image.url,
            alt: 'Photo',
            width: message.image.width,
            height: message.image.height,
          },
        ];
      }
      if (message.attachment !== undefined && message.attachment.kind === 'image') {
        return [
          {
            message,
            messageId: message.id,
            url: message.attachment.url,
            alt: message.attachment.name,
            ...(message.attachment.width === undefined ? {} : { width: message.attachment.width }),
            ...(message.attachment.height === undefined
              ? {}
              : { height: message.attachment.height }),
          },
        ];
      }
      return [];
    });
}

function albumAspectRatio(photo: AlbumPhoto): number {
  if (
    photo.width === undefined ||
    photo.height === undefined ||
    photo.width <= 0 ||
    photo.height <= 0
  ) {
    return FALLBACK_ASPECT_RATIO;
  }
  return photo.width / photo.height;
}

function AlbumTile({
  chatId,
  photo,
  onPress,
  onRetry,
  style,
  hidden,
  edgeToEdge = false,
}: {
  chatId: string;
  photo: AlbumPhoto;
  onPress: () => void;
  onRetry: ((message: UiMessage) => void) | undefined;
  style: StyleProp<ViewStyle>;
  hidden?: number | undefined;
  edgeToEdge?: boolean | undefined;
}) {
  const upload = mobileUploadOf(photo.message);
  const media = useMediaRetry(photo.url, upload.localUri);
  const openMenu = useOpenMessageMenu();
  const longPress =
    openMenu === undefined ? {} : { onLongPress: openMenu, delayLongPress: LONG_PRESS_MS };
  const hosts = useChatStore((state) => state.mediaTrustedHosts) ?? EMPTY_HOSTS;
  const failed = photo.message.failed === true || photo.message.status === 'failed';
  const gradient = imageGradient(photo.url);
  const trusted = isLoadableMediaUrl(photo.url, hosts);
  // A `gradient:` URL is a mock placeholder and is never fetched; a trusted URL
  // loads directly, with the local preview on top until it does.
  const remote = trusted && gradient === undefined && !media.failed;
  const loadedSource = useMediaSource(chatId, photo.url, remote);
  const source =
    loadedSource === undefined
      ? undefined
      : { ...loadedSource, uri: withMediaRetry(loadedSource.uri, media.retry) };
  const showTile = gradient !== undefined || media.localUri !== undefined || remote;

  return (
    <View
      style={style}
      className={cn(
        'relative overflow-hidden bg-well',
        edgeToEdge ? undefined : 'rounded-[10px] border border-edge',
      )}
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
          <>
            <Image
              recyclingKey={withMediaRetry(photo.url, media.retry)}
              source={source ?? null}
              accessibilityLabel={photo.alt}
              onLoad={media.onLoad}
              onError={media.onError}
              contentFit="cover"
              style={{ width: '100%', height: '100%' }}
            />
            {media.localUri !== undefined && !media.loaded ? (
              <Image
                source={{ uri: media.localUri }}
                accessibilityLabel={photo.alt}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
            ) : null}
          </>
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
      {media.failed && media.localUri === undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry image"
          onPress={media.restart}
          className="absolute inset-x-0 bottom-0 items-center justify-center bg-black/60 py-1"
        >
          <Text className="text-[11px] font-semibold text-white underline">Retry</Text>
        </Pressable>
      ) : null}
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
  const tile = (
    photo: AlbumPhoto,
    style: StyleProp<ViewStyle>,
    hidden?: number,
    edgeToEdge?: boolean,
  ) => (
    <AlbumTile
      key={photo.messageId}
      chatId={chatId}
      photo={photo}
      onPress={() => onOpen?.(photo.messageId, ids)}
      onRetry={onRetry}
      style={style}
      {...(hidden === undefined ? {} : { hidden })}
      {...(edgeToEdge === true ? { edgeToEdge: true } : {})}
    />
  );

  if (photos.length === 1) {
    return (
      <View>
        {tile(
          first,
          { width: GRID_WIDTH, aspectRatio: albumAspectRatio(first), maxHeight: MAX_IMAGE_HEIGHT },
          undefined,
          true,
        )}
      </View>
    );
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
