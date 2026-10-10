import type { Attachment } from '@zilar/protocol';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { FileText, RotateCcw, ArrowUpRight } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import {
  PinchGestureHandler,
  type PinchGestureHandlerEventPayload,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { isTrustedMediaUrl, safeHttpUrl } from '@/lib/attachments';
import { ICON } from '@/lib/colors';
import { imageGradient } from '@/lib/image-presets';
import { raisedPill } from '@/lib/depth';

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
 * "Not loaded: untrusted address" line. No URL is ever opened without a tap:
 * the viewer opens from `onOpen`.
 */
export function AttachmentImage({
  attachment,
  trustedHosts,
  localUri,
  uploading = false,
  progress,
  failed = false,
  onRetry,
  onOpen,
}: AttachmentImageProps) {
  const [broken, setBroken] = useState(false);
  const trusted = isLoadableMediaUrl(attachment.url, trustedHosts);
  // A `gradient:` URL is a mock-mode demo placeholder (never fetched): it
  // renders the gradient tile below, like `ImageMessage` does for legacy
  // `image` messages.
  const demoGradient = imageGradient(attachment.url);
  const remoteSource = localUri ?? (trusted && !broken ? attachment.url : undefined);
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

  if (remoteSource === undefined) {
    return (
      <View>
        <AttachmentFileRow attachment={attachment} trusted={false} onOpen={undefined} />
        {uploading ? (
          <Text className="mt-1 px-0.5 text-[12px] text-muted-foreground">Uploading…</Text>
        ) : null}
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
      >
        <View style={{ width: IMAGE_WIDTH }}>
          <Image
            source={{ uri: remoteSource }}
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

type AttachmentFileProps = {
  attachment: Attachment;
  /** False when the host is untrusted: the row shows the untrusted line. */
  trusted?: boolean | undefined;
  /** True while the bytes are still uploading. */
  uploading?: boolean | undefined;
  /** 0..1 upload progress, when known. */
  progress?: number | undefined;
  /** True when the upload failed; the card shows a Retry instead. */
  failed?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  /** Opens the file with the system share/open sheet (tap only). */
  onOpen?: (() => void) | undefined;
  /** True while the file is being downloaded for the open sheet. */
  opening?: boolean | undefined;
};

/**
 * A generic file attachment as a raised card: icon, name, size and MIME.
 * The bytes are never fetched automatically: `onOpen` (the system open
 * sheet) runs only on tap. An untrusted address shows the
 * "Not loaded: untrusted address" line instead of size and MIME.
 */
export function AttachmentFileRow({
  attachment,
  trusted = true,
  uploading = false,
  progress,
  failed = false,
  onRetry,
  onOpen,
  opening = false,
}: AttachmentFileProps) {
  const meta = failed
    ? 'Upload failed'
    : uploading
      ? progress === undefined
        ? 'Uploading…'
        : `Uploading… ${Math.round(progress * 100)}%`
      : trusted
        ? `${formatSize(attachment.size)} · ${attachment.mime}`
        : 'Not loaded: untrusted address';
  return (
    <View className="min-w-[210px] max-w-[320px]">
      <View className="flex-row items-center gap-2.5 rounded-[10px] px-2.5 py-2" style={raisedPill}>
        <View className="h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-surface">
          <FileText size={20} color={ICON} />
        </View>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[13px] font-semibold text-foreground">
            {attachment.name}
          </Text>
          <Text
            numberOfLines={1}
            className="font-mono text-[12px] tabular-nums text-muted-foreground"
          >
            {meta}
          </Text>
        </View>
        {failed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry upload"
            onPress={onRetry}
            className="h-8 w-8 shrink-0 items-center justify-center rounded-[8px] active:bg-surface"
          >
            <RotateCcw size={16} color={ICON} />
          </Pressable>
        ) : opening || uploading ? (
          <ActivityIndicator accessibilityLabel={opening ? 'Opening' : 'Uploading'} />
        ) : onOpen === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              trusted ? `Open ${attachment.name}` : `Try opening ${attachment.name}`
            }
            onPress={onOpen}
            className="h-8 w-8 shrink-0 items-center justify-center rounded-[8px] active:bg-surface"
          >
            <ArrowUpRight size={16} color={ICON} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** Backwards-compatible alias: the bubble imports `AttachmentFile`. */
export const AttachmentFile = AttachmentFileRow;

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

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

type AttachmentViewerProps = {
  /** The image URL to show full-screen, or undefined when closed. */
  url: string | undefined;
  name: string;
  onClose: () => void;
};

/**
 * The full-screen image viewer: pinch-to-zoom with a double-tap toggle and
 * a close button. Plain `Image` at device width, so GIF/WebP animate as in
 * the bubble.
 */
export function AttachmentViewer({ url, name, onClose }: AttachmentViewerProps) {
  const insets = useSafeAreaInsets();
  const [scale, setScale] = useState(1);
  if (url === undefined) {
    return null;
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/95" style={{ paddingTop: Math.max(insets.top, 8) }}>
        <View className="flex-row justify-end px-3 py-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close viewer"
            onPress={onClose}
            className="rounded-full bg-surface px-4 py-2 active:opacity-80"
          >
            <Text className="text-[15px] font-semibold text-foreground">Close</Text>
          </Pressable>
        </View>
        <View className="flex-1 items-center justify-center px-2">
          <ZoomableImage uri={url} name={name} scale={scale} onScale={setScale} />
        </View>
      </View>
    </Modal>
  );
}

function ZoomableImage({
  uri,
  name,
  scale,
  onScale,
}: {
  uri: string;
  name: string;
  scale: number;
  onScale: (scale: number) => void;
}) {
  // Pinch-to-zoom around 1x, clamped to 1–4x; releasing leaves the zoom where
  // it is, and a double-tap toggles back to 1x.
  const [base, setBase] = useState(1);
  const [lastTapAt, setLastTapAt] = useState(0);
  const handlePinch = (event: { nativeEvent: PinchGestureHandlerEventPayload }) => {
    onScale(Math.min(4, Math.max(1, base * event.nativeEvent.scale)));
  };
  const handlePinchEnd = () => {
    setBase(scale);
  };
  const handlePress = () => {
    const now = Date.now();
    if (now - lastTapAt < 300) {
      onScale(1);
      setBase(1);
    }
    setLastTapAt(now);
  };
  return (
    <PinchGestureHandler onGestureEvent={handlePinch} onEnded={handlePinchEnd}>
      <Pressable
        accessibilityRole="image"
        accessibilityLabel={name}
        onPress={handlePress}
        className="h-full w-full items-center justify-center"
      >
        <Image
          source={{ uri }}
          accessibilityLabel={name}
          contentFit="contain"
          style={{ width: '100%', height: '100%', transform: [{ scale }] }}
        />
      </Pressable>
    </PinchGestureHandler>
  );
}
