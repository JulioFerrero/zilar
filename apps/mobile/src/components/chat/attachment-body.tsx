import { formatTime, parseUrl, photosOf, type UiMessage, type ViewerPhoto } from '@zilar/chat-core';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AlbumGrid } from '@/components/chat/album-grid';
import {
  AttachmentFileRow,
  AttachmentImage,
  AttachmentViewer,
} from '@/components/chat/attachment-message';
import { AttachmentVideo } from '@/components/chat/attachment-video';
import { isGifVideoAttachment } from '@/lib/attachments';
import { BUBBLE_COLORS, FOREGROUND, SEEN } from '@/lib/colors';
import { Text } from '@/components/ui/text';
import { Ticks } from '@/components/chat/ticks';
import { mobileUploadOf } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * The outgoing bubble's text colour, the same literal `MessageBubble` uses
 * (`message-bubble.tsx:164`): an outgoing bubble is light, so its text is dark.
 */
const OUTGOING_TEXT_COLOR = '#0a0a0a';

type AttachmentBodyProps = {
  message: UiMessage;
  outgoing: boolean;
  onRetryAttachment?: ((message: UiMessage) => void) | undefined;
  onCancelAttachment?: ((message: UiMessage) => void) | undefined;
  onOpenAttachment?: ((message: UiMessage) => void) | undefined;
  opening?: boolean | undefined;
};

/**
 * An attachment message body (T-0150): image, GIF-video, or file, plus the
 * caption as plain text underneath. Mirrors web's `MessageBubble` branches:
 * images render inline (trusted hosts only), GIF-origin videos (`gif-` name
 * + video mime) play inline, everything else is a file row whose bytes are
 * only fetched on tap. A failed upload shows Retry; an in-flight upload
 * shows progress with Cancel.
 */
export function AttachmentBody({
  message,
  outgoing,
  onRetryAttachment,
  onCancelAttachment,
  onOpenAttachment,
  opening = false,
}: AttachmentBodyProps) {
  const attachment = message.attachment;
  const [viewer, setViewer] = useState<{
    messageId: string;
    albumIds?: readonly string[];
  } | null>(null);
  const trustedHosts = useChatStore((state) => state.mediaTrustedHosts);
  const messages = useChatStore((state) => state.messagesByChat[message.chatId]);
  const photos = useMemo(() => photosOf(messages ?? []), [messages]);
  // Opening a tile scopes the viewer to the album (§4.5): the album's photos
  // first, in `index` order, then the rest of the chat. A single-photo open
  // keeps the chat's photo order unchanged.
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
  const hosts = trustedHosts ?? new Set<string>();
  if (attachment === undefined) {
    return null;
  }
  // The bubble's own text colours, mirroring `MessageBubble`
  // (`message-bubble.tsx:150` for the meta shade, `:164` for the text): an
  // outgoing bubble is light, so the caption and the meta line need the dark
  // shades the plain text bubble uses, not the app's near-white foreground.
  const textColor = outgoing ? OUTGOING_TEXT_COLOR : FOREGROUND;
  const metaColor = outgoing ? BUBBLE_COLORS.outgoingMeta : BUBBLE_COLORS.incomingMeta;
  const upload = mobileUploadOf(message);
  const uploading = message.status === 'sending' && message.failed !== true;
  const failed = message.failed === true;
  const gifVideo = isGifVideoAttachment(attachment, hosts);
  const content =
    message.album !== undefined ? (
      <AlbumGrid
        message={message}
        onOpen={
          failed || uploading
            ? undefined
            : (messageId, albumIds) => setViewer({ messageId, albumIds })
        }
        {...(onRetryAttachment === undefined ? {} : { onRetry: onRetryAttachment })}
      />
    ) : attachment.kind === 'image' && !gifVideo ? (
      <AttachmentImage
        attachment={attachment}
        chatId={message.chatId}
        trustedHosts={hosts}
        localUri={upload.localUri}
        uploading={uploading}
        progress={upload.uploadProgress}
        failed={failed}
        onRetry={failed ? () => onRetryAttachment?.(message) : undefined}
        onOpen={failed || uploading ? undefined : () => setViewer({ messageId: message.id })}
      />
    ) : attachment.kind === 'file' && !gifVideo ? (
      <AttachmentFileRow
        attachment={attachment}
        trusted={isFileTrusted(attachment.url, hosts)}
        uploading={uploading}
        progress={upload.uploadProgress}
        failed={failed}
        onRetry={failed ? () => onRetryAttachment?.(message) : undefined}
        onOpen={failed || uploading ? undefined : () => onOpenAttachment?.(message)}
        opening={opening}
      />
    ) : (
      <AttachmentVideo
        attachment={attachment}
        chatId={message.chatId}
        trustedHosts={hosts}
        localUri={upload.localUri}
        uploading={uploading}
        progress={upload.uploadProgress}
        failed={failed}
        onRetry={failed ? () => onRetryAttachment?.(message) : undefined}
      />
    );

  return (
    <View>
      <View className="relative">
        {content}
        {uploading || failed ? (
          <CancelOrRetry
            uploading={uploading}
            failed={failed}
            onCancel={() => onCancelAttachment?.(message)}
            onRetry={() => onRetryAttachment?.(message)}
          />
        ) : null}
      </View>
      {message.text !== undefined && message.text.length > 0 ? (
        <Text className="mt-1 px-0.5 text-[15px]" color={textColor}>
          {message.text}
        </Text>
      ) : null}
      <View className="mt-1 flex-row items-center justify-end gap-1">
        {message.edited === true ? (
          <Text className="font-mono text-[10px]" color={metaColor}>
            edited
          </Text>
        ) : null}
        <Text className="font-mono text-[10px]" color={metaColor}>
          {formatTime(message.createdAt)}
        </Text>
        {outgoing ? (
          <Ticks
            status={message.status}
            color={message.status === 'read' ? SEEN : metaColor}
            size={13}
          />
        ) : null}
      </View>
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

/**
 * Whether a file row may offer the open control: files never auto-load, and
 * the open sheet itself is the tap-gated fetch. The button shows for every
 * file regardless of host (the tap IS the trust decision for files); the
 * "Not loaded" line marks untrusted addresses. `javascript:`/`data:` URLs
 * never open: the handler treats them as unopenable.
 */
function isFileTrusted(url: string, hosts: ReadonlySet<string>): boolean {
  const parsed = parseUrl(url);
  if (parsed === undefined) {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  return hosts.has(parsed.hostname.toLowerCase());
}

function CancelOrRetry({
  uploading,
  failed,
  onCancel,
  onRetry,
}: {
  uploading: boolean;
  failed: boolean;
  onCancel: () => void;
  onRetry: () => void;
}) {
  if (failed) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry sending attachment"
        onPress={onRetry}
        className="mt-1 rounded-[10px] bg-danger/20 px-3 py-1.5 active:opacity-80"
      >
        <Text className="text-[13px] font-semibold text-danger">Couldn't send. Retry</Text>
      </Pressable>
    );
  }
  if (!uploading) {
    return null;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Cancel upload"
      onPress={onCancel}
      className="mt-1 self-start rounded-[10px] px-2 py-1 active:bg-surface-raised"
    >
      <Text className="text-[13px] text-muted-foreground">Cancel</Text>
    </Pressable>
  );
}
