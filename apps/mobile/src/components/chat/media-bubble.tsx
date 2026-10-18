import { photosOf, type UiMessage, type ViewerPhoto } from '@zilar/chat-core';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AlbumGrid } from '@/components/chat/album-grid';
import { AttachmentVideo } from '@/components/chat/attachment-video';
import { AttachmentViewer, isLoadableMediaUrl } from '@/components/chat/attachment-message';
import { AttachmentFileRow } from '@/components/chat/file-bubble';
import { ImageMessage } from '@/components/chat/image-message';
import { MEDIA_WIDTH, mediaFrame } from '@/components/chat/media-frame';
import { MediaMetaPill } from '@/components/chat/media-meta-pill';
import { LONG_PRESS_MS } from '@/components/chat/message-bubble-decor';
import { useOpenMessageMenu } from '@/components/chat/message-menu-context';
import { PlainBubbleBody } from '@/components/chat/plain-bubble-body';
import { Text } from '@/components/ui/text';
import { imageAttachmentRender, isGifVideoAttachment } from '@/lib/attachments';
import { imageGradient } from '@/lib/image-presets';
import { useMediaRetry, withMediaRetry } from '@/lib/media-retry';
import { useMediaSource } from '@/lib/media-source';
import { mobileUploadOf } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';

const EMPTY_HOSTS: ReadonlySet<string> = new Set();

// A photo (legacy `image` or an `image` attachment), an album, or a GIF-origin video drops the bubble's padding so the media is the bubble, edge to edge.
export function isMediaFirstMessage(message: UiMessage, hosts: ReadonlySet<string>): boolean {
  if (message.image !== undefined || message.album !== undefined) {
    return true;
  }
  const attachment = message.attachment;
  if (attachment === undefined) {
    return false;
  }
  return attachment.kind === 'image' || isGifVideoAttachment(attachment, hosts);
}

type MediaBubbleProps = {
  message: UiMessage;
  outgoing: boolean;
  text: string;
  textColor: string;
  metaColor: string;
  reduceMotion: boolean;
  meJid?: string | undefined;
  onRetryAttachment?: ((message: UiMessage) => void) | undefined;
  onCancelAttachment?: ((message: UiMessage) => void) | undefined;
};

// The media fills the bubble; with no caption the time and ticks sit in a dark pill on the photo, with a caption they render below in the normal text padding.
export function MediaBubble({
  message,
  outgoing,
  text,
  textColor,
  metaColor,
  reduceMotion,
  meJid,
  onRetryAttachment,
  onCancelAttachment,
}: MediaBubbleProps) {
  const attachment = message.attachment;
  const hosts = useChatStore((state) => state.mediaTrustedHosts) ?? EMPTY_HOSTS;
  const messages = useChatStore((state) => state.messagesByChat[message.chatId]);
  const [viewer, setViewer] = useState<{ messageId: string; albumIds?: readonly string[] } | null>(
    null,
  );
  // The same viewer scoping as the attachment body: an album opens its members first, then the rest of the chat.
  const photos = useMemo(() => photosOf(messages ?? []), [messages]);
  const viewerPhotos = useMemo<ViewerPhoto[]>(() => {
    if (viewer === null || viewer.albumIds === undefined) {
      return photos;
    }
    const inScope = new Set(viewer.albumIds);
    const album = viewer.albumIds
      .map((id) => photos.find((photo) => photo.messageId === id))
      .filter((photo): photo is ViewerPhoto => photo !== undefined);
    return [...album, ...photos.filter((photo) => !inScope.has(photo.messageId))];
  }, [photos, viewer]);
  const startIndex =
    viewer === null
      ? 0
      : Math.max(
          0,
          viewerPhotos.findIndex((photo) => photo.messageId === viewer.messageId),
        );
  const upload = mobileUploadOf(message);
  const uploading = message.status === 'sending' && message.failed !== true;
  const failed = message.failed === true;
  const gifVideo = attachment !== undefined && isGifVideoAttachment(attachment, hosts);
  const hasCaption = message.text !== undefined && message.text.length > 0;
  // A picture is drawn for a legacy image, an album, a GIF video, or an image attachment with a trusted URL, a demo gradient or the local `file://` preview while it uploads; the pill keeps the timestamp in every one.
  const showsMedia =
    message.album !== undefined ||
    message.image !== undefined ||
    gifVideo ||
    (attachment !== undefined &&
      attachment.kind === 'image' &&
      (imageGradient(attachment.url) !== undefined ||
        isLoadableMediaUrl(attachment.url, hosts) ||
        upload.localUri !== undefined));
  // An untrusted image URL renders the click-to-load file row instead, but it is still media-first: the pill keeps its timestamp.
  const untrustedImage =
    attachment !== undefined &&
    attachment.kind === 'image' &&
    !gifVideo &&
    upload.localUri === undefined &&
    !showsMedia;
  // A single photo fits its ratio: a tall screenshot used to shrink inside the fixed 240 px wrapper and leave a white bar beside it. Albums, GIFs and non-photo states keep the full width.
  const imageSize =
    message.image ??
    (attachment !== undefined && attachment.kind === 'image' ? attachment : undefined);
  const imageRatio =
    imageSize !== undefined &&
    imageSize.width !== undefined &&
    imageSize.height !== undefined &&
    imageSize.height > 0
      ? imageSize.width / imageSize.height
      : undefined;
  const singlePhoto =
    message.album === undefined &&
    !gifVideo &&
    (message.image !== undefined ||
      (attachment !== undefined && attachment.kind === 'image' && !failed && !untrustedImage));
  const bubbleWidth = singlePhoto ? mediaFrame(imageRatio).width : MEDIA_WIDTH;

  let media: ReactNode = null;
  if (message.album !== undefined) {
    media = (
      <AlbumGrid
        message={message}
        onOpen={
          failed || uploading
            ? undefined
            : (messageId, albumIds) => setViewer({ messageId, albumIds })
        }
        {...(onRetryAttachment === undefined ? {} : { onRetry: onRetryAttachment })}
      />
    );
  } else if (message.image !== undefined) {
    media = <ImageMessage image={message.image} />;
  } else if (attachment !== undefined && attachment.kind === 'image' && !gifVideo) {
    media = (
      <MediaImage
        chatId={message.chatId}
        attachment={attachment}
        hosts={hosts}
        outgoing={outgoing}
        {...(upload.localUri === undefined ? {} : { localUri: upload.localUri })}
        uploading={uploading}
        {...(upload.uploadProgress === undefined ? {} : { progress: upload.uploadProgress })}
        failed={failed}
        {...(onRetryAttachment === undefined ? {} : { onRetry: () => onRetryAttachment(message) })}
        onOpen={failed || uploading ? undefined : () => setViewer({ messageId: message.id })}
      />
    );
  } else if (gifVideo && attachment !== undefined) {
    media = (
      <AttachmentVideo
        attachment={attachment}
        chatId={message.chatId}
        trustedHosts={hosts}
        {...(upload.localUri === undefined ? {} : { localUri: upload.localUri })}
        uploading={uploading}
        {...(upload.uploadProgress === undefined ? {} : { progress: upload.uploadProgress })}
        failed={failed}
        {...(onRetryAttachment === undefined ? {} : { onRetry: () => onRetryAttachment(message) })}
      />
    );
  }

  return (
    <View style={{ width: bubbleWidth }}>
      <View className="relative">
        {media}
        {!hasCaption && (showsMedia || failed || untrustedImage) ? (
          <MediaMetaPill
            message={message}
            outgoing={outgoing}
            className="absolute right-2 bottom-2"
          />
        ) : null}
      </View>
      {uploading ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel upload"
          onPress={() => onCancelAttachment?.(message)}
          className="mt-1 self-start rounded-[10px] px-2 py-1 active:bg-surface-raised"
        >
          <Text className="text-[13px] text-muted-foreground">Cancel</Text>
        </Pressable>
      ) : null}
      {hasCaption ? (
        <View className="px-3 py-2">
          <PlainBubbleBody
            message={message}
            outgoing={outgoing}
            generating={false}
            text={text}
            textColor={textColor}
            metaColor={metaColor}
            reduceMotion={reduceMotion}
            meJid={meJid}
          />
        </View>
      ) : null}
      {viewer !== null && !failed && !uploading ? (
        <AttachmentViewer
          chatId={message.chatId}
          photos={viewerPhotos}
          startIndex={startIndex}
          trustedHosts={hosts}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </View>
  );
}

type MediaImageProps = {
  chatId: string;
  attachment: NonNullable<UiMessage['attachment']>;
  hosts: ReadonlySet<string>;
  outgoing: boolean;
  localUri?: string | undefined;
  uploading: boolean;
  progress?: number | undefined;
  failed: boolean;
  onRetry?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
};

// An edge-to-edge image attachment: no border or radius of its own, so the bubble's clip gives it the corners.
function MediaImage({
  chatId,
  attachment,
  hosts,
  outgoing,
  localUri,
  uploading,
  progress,
  failed,
  onRetry,
  onOpen,
}: MediaImageProps) {
  const media = useMediaRetry(attachment.url, localUri);
  // The inner `Pressable`s swallow the outer bubble's `onLongPress`, so forward the menu open; a short tap still opens the viewer.
  const openMenu = useOpenMessageMenu();
  const longPress =
    openMenu === undefined ? {} : { onLongPress: openMenu, delayLongPress: LONG_PRESS_MS };
  const trusted = isLoadableMediaUrl(attachment.url, hosts);
  const demoGradient = imageGradient(attachment.url);
  const render = imageAttachmentRender({
    trusted,
    broken: media.failed,
    hasLocalUri: media.localUri !== undefined,
  });
  const remote = trusted && !media.failed;
  const loadedSource = useMediaSource(chatId, attachment.url, remote);
  const source =
    loadedSource === undefined
      ? undefined
      : { ...loadedSource, uri: withMediaRetry(loadedSource.uri, media.retry) };
  const alt = attachment.name;
  const ratio =
    attachment.width !== undefined && attachment.height !== undefined
      ? attachment.width / attachment.height
      : undefined;
  const size = mediaFrame(ratio);

  if (failed) {
    return (
      <View className="flex-row items-center gap-2 px-3 py-2">
        <Text className="text-[12px] text-danger">Upload failed</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry upload"
          onPress={onRetry}
          className="rounded px-1 py-0.5 active:bg-surface-raised"
        >
          <Text className="text-[12px] font-semibold text-danger">Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (demoGradient !== undefined && media.localUri === undefined) {
    return (
      <Pressable
        accessibilityRole="image"
        accessibilityLabel={alt}
        onPress={onOpen}
        disabled={onOpen === undefined}
        className="overflow-hidden"
        {...longPress}
      >
        <LinearGradient
          colors={demoGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={size}
        />
      </Pressable>
    );
  }

  if (render === 'untrusted') {
    return (
      <View className="px-3 py-2">
        <AttachmentFileRow attachment={attachment} outgoing={outgoing} trusted={false} />
      </View>
    );
  }

  if (render === 'load-failed') {
    return (
      <View className="px-3 py-2">
        <AttachmentFileRow
          attachment={attachment}
          outgoing={outgoing}
          loadFailed
          onRetry={() => media.restart()}
        />
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="image"
      accessibilityLabel={alt}
      onPress={onOpen}
      disabled={onOpen === undefined}
      className="overflow-hidden"
      {...longPress}
    >
      <Image
        recyclingKey={withMediaRetry(attachment.url, media.retry)}
        source={source ?? null}
        accessibilityLabel={alt}
        onLoad={media.onLoad}
        onError={media.onError}
        style={size}
        contentFit="cover"
      />
      {media.localUri !== undefined && !media.loaded ? (
        <Image
          source={{ uri: media.localUri }}
          accessibilityLabel={alt}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      ) : null}
      {uploading ? (
        <View className="absolute inset-0 items-center justify-center bg-black/40">
          <ActivityIndicator accessibilityLabel="Uploading" />
          {progress !== undefined ? (
            <Text className="mt-1 font-mono text-[11px] text-foreground">
              {Math.round(progress * 100)}%
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
