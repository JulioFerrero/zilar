import { parseUrl, type UiMessage } from '@zilar/chat-core';
import { Pressable, View } from 'react-native';

import { AlbumGrid } from '@/components/chat/album-grid';
import { AttachmentImage, AttachmentViewer } from '@/components/chat/attachment-message';
import { AttachmentFileRow } from '@/components/chat/file-bubble';
import { AttachmentVideo } from '@/components/chat/attachment-video';
import { useAttachmentViewer } from '@/components/chat/media-shared';
import { metaTimeText } from '@/components/chat/meta-time';
import { isGifVideoAttachment } from '@/lib/attachments';
import { BUBBLE_COLORS, FOREGROUND, MUTED_FOREGROUND, SEEN } from '@/lib/colors';
import { Text } from '@/components/ui/text';
import { Ticks } from '@/components/chat/ticks';
import { mobileUploadOf } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';

const OUTGOING_TEXT_COLOR = '#0a0a0a';

type AttachmentBodyProps = {
  message: UiMessage;
  outgoing: boolean;
  onRetryAttachment?: ((message: UiMessage) => void) | undefined;
  onCancelAttachment?: ((message: UiMessage) => void) | undefined;
  onOpenAttachment?: ((message: UiMessage) => void) | undefined;
  opening?: boolean | undefined;
};

export function AttachmentBody({
  message,
  outgoing,
  onRetryAttachment,
  onCancelAttachment,
  onOpenAttachment,
  opening = false,
}: AttachmentBodyProps) {
  const attachment = message.attachment;
  const trustedHosts = useChatStore((state) => state.mediaTrustedHosts);
  const messages = useChatStore((state) => state.messagesByChat[message.chatId]);
  const { viewer, setViewer, viewerPhotos, startIndex } = useAttachmentViewer(messages);
  const hosts = trustedHosts ?? new Set<string>();
  if (attachment === undefined) {
    return null;
  }
  const textColor = outgoing ? OUTGOING_TEXT_COLOR : FOREGROUND;
  const metaColor = outgoing ? BUBBLE_COLORS.outgoingMeta : MUTED_FOREGROUND;
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
        outgoing={outgoing}
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
        outgoing={outgoing}
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
        <Text className="font-mono text-[11px]" color={metaColor}>
          {metaTimeText(message)}
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

/** Files never auto-load: the open sheet is the tap-gated fetch, and the tap is
 *  the trust decision. `javascript:` and `data:` URLs never open. */
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
        <Text className="text-[13px] font-semibold text-danger">Could not send. Try again.</Text>
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
