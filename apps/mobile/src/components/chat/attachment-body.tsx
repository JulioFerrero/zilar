import type { UiMessage } from '@zilar/chat-core';
import { formatTime } from '@zilar/chat-core';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  AttachmentFileRow,
  AttachmentImage,
  AttachmentViewer,
} from '@/components/chat/attachment-message';
import { AttachmentVideo } from '@/components/chat/attachment-video';
import { isGifVideoAttachment } from '@/lib/attachments';
import { Text } from '@/components/ui/text';
import { Ticks } from '@/components/chat/ticks';
import { mobileUploadOf } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';

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
  const [viewerOpen, setViewerOpen] = useState(false);
  const trustedHosts = useChatStore((state) => state.mediaTrustedHosts);
  const hosts = trustedHosts ?? new Set<string>();
  if (attachment === undefined) {
    return null;
  }
  const upload = mobileUploadOf(message);
  const uploading = message.status === 'sending' && message.failed !== true;
  const failed = message.failed === true;
  const gifVideo = isGifVideoAttachment(attachment, hosts);
  const content =
    attachment.kind === 'image' && !gifVideo ? (
      <AttachmentImage
        attachment={attachment}
        trustedHosts={hosts}
        localUri={upload.localUri}
        uploading={uploading}
        progress={upload.uploadProgress}
        failed={failed}
        onRetry={failed ? () => onRetryAttachment?.(message) : undefined}
        onOpen={failed || uploading ? undefined : () => setViewerOpen(true)}
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
        <Text className="mt-1 px-0.5 text-[15px] text-foreground">{message.text}</Text>
      ) : null}
      <View className="mt-1 flex-row items-center justify-end gap-1">
        {message.edited === true ? (
          <Text className="font-mono text-[10px] text-muted-foreground">edited</Text>
        ) : null}
        <Text className="font-mono text-[10px] text-muted-foreground">
          {formatTime(message.createdAt)}
        </Text>
        {outgoing ? <Ticks status={message.status} color="#8a8a8a" size={13} /> : null}
      </View>
      {attachment.kind === 'image' && !gifVideo && !failed && !uploading ? (
        <AttachmentViewer
          url={viewerOpen ? viewableUrl(attachment.url, hosts) : undefined}
          name={attachment.name}
          onClose={() => setViewerOpen(false)}
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
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return hosts.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** The viewer URL: only a trusted http(s) URL, never user-supplied schemes. */
function viewableUrl(url: string, hosts: ReadonlySet<string>): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return hosts.has(parsed.hostname.toLowerCase()) ? url : undefined;
  } catch {
    return undefined;
  }
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
