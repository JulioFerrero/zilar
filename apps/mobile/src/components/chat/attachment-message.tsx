import type { Attachment } from '@zilar/protocol';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AttachmentFileRow } from '@/components/chat/file-bubble';
import { LONG_PRESS_MS } from '@/components/chat/message-bubble-decor';
import { useOpenMessageMenu } from '@/components/chat/message-menu-context';
import { Text } from '@/components/ui/text';
import { imageAttachmentRender, isTrustedMediaUrl, safeHttpUrl } from '@/lib/attachments';
import { imageGradient } from '@/lib/image-presets';
import { useMediaSource } from '@/lib/media-source';

export { AttachmentViewer } from './image-viewer';

const IMAGE_WIDTH = 240;
const MAX_IMAGE_HEIGHT = 320;

/**
 * A trusted-host gate shared by image and GIF-video rendering: the URL must
 * be http(s) and on one of the store's media hosts (`mediaTrustedHosts`).
 * Anything else — a hostile absolute URL, `javascript:`, `data:`, relative
 * paths, garbage — never loads.
 */
export function isLoadableMediaUrl(url: string, trustedHosts: ReadonlySet<string>): boolean {
  if (safeHttpUrl(url) === undefined) {
    return false;
  }
  return isTrustedMediaUrl(url, trustedHosts);
}

type AttachmentImageProps = {
  attachment: Attachment;
  /** The message's chat, for the `GET /api/files` proxy URL (T-1185). */
  chatId: string;
  /** True when this is the sender's own bubble, for the fallback file row. */
  outgoing?: boolean | undefined;
  /** The store's trusted media hosts (service host, domain, upload.domain). */
  trustedHosts: ReadonlySet<string>;
  /** The local preview URI while the bytes are still uploading. */
  localUri?: string | undefined;
  /** True while the bytes are still uploading. */
  uploading?: boolean | undefined;
  /** 0..1 upload progress, when known. */
  progress?: number | undefined;
  /** True when the upload failed; the card shows a Retry instead. */
  failed?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  /** Opens the full-screen viewer (images) or fullscreen video. */
  onOpen?: (() => void) | undefined;
};

/**
 * An image attachment bubble. A trusted URL auto-loads through `expo-image`
 * (animated GIF/WebP included); a local URI shows while the upload runs; an
 * untrusted URL never fetches and falls back to the file row with a
 * "Not loaded: untrusted address" line; a trusted URL whose fetch failed shows
 * a "Couldn't load" row with a retry. No URL is ever opened without a tap:
 * the viewer opens from `onOpen`.
 */
export function AttachmentImage({
  attachment,
  chatId,
  outgoing = false,
  trustedHosts,
  localUri,
  uploading = false,
  progress,
  failed = false,
  onRetry,
  onOpen,
}: AttachmentImageProps) {
  const [broken, setBroken] = useState(false);
  const openMenu = useOpenMessageMenu();
  const longPress =
    openMenu === undefined ? {} : { onLongPress: openMenu, delayLongPress: LONG_PRESS_MS };
  const trusted = isLoadableMediaUrl(attachment.url, trustedHosts);
  // A `gradient:` URL is a mock-mode demo placeholder (never fetched): it
  // renders the gradient tile below, like `ImageMessage` does for legacy
  // `image` messages.
  const demoGradient = imageGradient(attachment.url);
  const render = imageAttachmentRender({
    trusted,
    broken,
    hasLocalUri: localUri !== undefined,
  });
  const remote = trusted && !broken;
  // The bytes go through `GET /api/files` (with the bearer) when this is our
  // own `/upload/` file; a local preview or another origin loads directly.
  const loaded = useMediaSource(chatId, attachment.url, remote && localUri === undefined);
  const source = localUri === undefined ? loaded : { uri: localUri };
  const alt = attachment.name;
  const ratio =
    attachment.width !== undefined && attachment.height !== undefined
      ? attachment.width / attachment.height
      : undefined;

  if (failed) {
    return <UploadFailed onRetry={onRetry} />;
  }

  // Mock-mode demo placeholder: a visible gradient tile with the file name,
  // exactly like `ImageMessage` renders legacy `gradient:` images. Never a
  // fetch, never the "Not loaded" row.
  if (demoGradient !== undefined && localUri === undefined) {
    return (
      <View>
        <Pressable
          accessibilityRole="image"
          accessibilityLabel={alt}
          onPress={onOpen}
          disabled={onOpen === undefined}
          className="overflow-hidden rounded-xl border border-edge"
          {...longPress}
        >
          <LinearGradient
            colors={demoGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={
              ratio === undefined
                ? { width: IMAGE_WIDTH, height: MAX_IMAGE_HEIGHT }
                : { width: IMAGE_WIDTH, aspectRatio: ratio, maxHeight: MAX_IMAGE_HEIGHT }
            }
          />
        </Pressable>
        <Text numberOfLines={1} className="mt-1 px-0.5 text-[13px] font-semibold text-foreground">
          {alt}
        </Text>
        {uploading ? (
          <Text className="mt-1 px-0.5 text-[12px] text-muted-foreground">Uploading…</Text>
        ) : null}
      </View>
    );
  }

  if (render === 'untrusted') {
    return (
      <View>
        <AttachmentFileRow
          attachment={attachment}
          outgoing={outgoing}
          trusted={false}
          onOpen={undefined}
        />
        {uploading ? (
          <Text className="mt-1 px-0.5 text-[12px] text-muted-foreground">Uploading…</Text>
        ) : null}
      </View>
    );
  }

  // A trusted image whose fetch failed is a load problem, not a trust problem:
  // "Couldn't load" with a retry that re-attempts the fetch, never the
  // "untrusted address" line and the dead card.
  if (render === 'load-failed') {
    return (
      <View>
        <AttachmentFileRow
          attachment={attachment}
          outgoing={outgoing}
          loadFailed
          onRetry={() => {
            setBroken(false);
          }}
        />
      </View>
    );
  }

  return (
    <View>
      <Pressable
        accessibilityRole="image"
        accessibilityLabel={alt}
        onPress={onOpen}
        disabled={onOpen === undefined}
        className="overflow-hidden rounded-xl border border-edge"
        {...longPress}
      >
        <View style={{ width: IMAGE_WIDTH }}>
          <Image
            recyclingKey={localUri ?? attachment.url}
            source={source ?? null}
            accessibilityLabel={alt}
            onError={() => setBroken(true)}
            style={
              ratio === undefined
                ? { width: IMAGE_WIDTH, height: MAX_IMAGE_HEIGHT }
                : { width: IMAGE_WIDTH, aspectRatio: ratio, maxHeight: MAX_IMAGE_HEIGHT }
            }
            contentFit="cover"
          />
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
        </View>
      </Pressable>
      {uploading ? (
        <Text className="mt-1 px-0.5 text-[12px] text-muted-foreground">Uploading…</Text>
      ) : null}
    </View>
  );
}

/** The failed-upload row under an image bubble: message plus Retry. */
function UploadFailed({ onRetry }: { onRetry?: (() => void) | undefined }) {
  return (
    <View className="flex-row items-center gap-2 px-0.5">
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
