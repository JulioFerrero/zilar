import { formatFileSize } from '@zilar/chat-core';
import type { Attachment } from '@zilar/protocol';
import { ArrowDown, FileText, RotateCcw } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import {
  ACCENT,
  ACCENT_FOREGROUND,
  BUBBLE_COLORS,
  FOREGROUND,
  ICON,
  MUTED_FOREGROUND,
} from '@/lib/colors';

type AttachmentFileProps = {
  attachment: Attachment;
  /** True when this is the sender's own bubble: it is light, so text is dark. */
  outgoing?: boolean | undefined;
  /** False when the host is untrusted: the row shows the untrusted line. */
  trusted?: boolean | undefined;
  /** True while the bytes are still uploading. */
  uploading?: boolean | undefined;
  /** 0..1 upload progress, when known. */
  progress?: number | undefined;
  /** True when the upload failed; the row shows a Retry instead. */
  failed?: boolean | undefined;
  /** True when a trusted inline fetch failed; the row shows a load Retry. */
  loadFailed?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  /** Opens the file with the app for its type (tap only). */
  onOpen?: (() => void) | undefined;
  /** True while the file is being downloaded to hand to the type's app. */
  opening?: boolean | undefined;
};

/**
 * A file attachment bubble, Telegram-style (T-1319): a round accent circle
 * (a download arrow before the first open, a spinner while loading), next to
 * it the file name and "3.9 KB PDF" below. No inner card: the bubble's own
 * surface is the card. The bytes are never fetched automatically: `onOpen`
 * (the app for the file's type) runs only on tap. An untrusted address shows
 * the "Not loaded: untrusted address" line instead of size and type; a
 * trusted address whose inline fetch failed shows "Couldn't load" with a
 * retry, and a failed upload shows "Upload failed" with a retry.
 *
 * An own (outgoing) bubble is light, so its text uses the dark bubble
 * shades and the circle uses the dark incoming surface instead of the
 * near-white accent, which would vanish on the light bubble.
 */
export function AttachmentFileRow({
  attachment,
  outgoing = false,
  trusted = true,
  uploading = false,
  progress,
  failed = false,
  loadFailed = false,
  onRetry,
  onOpen,
  opening = false,
}: AttachmentFileProps) {
  const [opened, setOpened] = useState(false);
  const busy = opening || uploading;
  const canOpen = onOpen !== undefined && !busy && !failed && !loadFailed;
  const meta = failed
    ? 'Upload failed'
    : uploading
      ? progress === undefined
        ? 'Uploading…'
        : `Uploading… ${Math.round(progress * 100)}%`
      : loadFailed
        ? "Couldn't load"
        : trusted
          ? sizeTypeOf(attachment) || attachment.mime
          : 'Not loaded: untrusted address';
  const titleColor = outgoing ? ACCENT_FOREGROUND : FOREGROUND;
  const metaColor = outgoing ? BUBBLE_COLORS.outgoingMeta : MUTED_FOREGROUND;
  const iconColor = outgoing ? FOREGROUND : ACCENT_FOREGROUND;
  const retryColor = outgoing ? ACCENT_FOREGROUND : ICON;
  const circleStyle = { backgroundColor: outgoing ? BUBBLE_COLORS.incoming : ACCENT };
  const Icon = canOpen && !opened ? ArrowDown : FileText;

  return (
    <View className="min-w-[210px] max-w-[320px] flex-row items-center gap-2.5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={trusted ? `Open ${attachment.name}` : `Try opening ${attachment.name}`}
        accessibilityState={{ disabled: !canOpen, busy }}
        disabled={!canOpen}
        onPress={() => {
          setOpened(true);
          onOpen?.();
        }}
        className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-80"
      >
        <View
          className="h-12 w-12 shrink-0 items-center justify-center rounded-full"
          style={circleStyle}
        >
          {busy ? (
            <ActivityIndicator
              accessibilityLabel={opening ? 'Opening' : 'Uploading'}
              color={iconColor}
            />
          ) : (
            <Icon size={24} color={iconColor} />
          )}
        </View>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[14px] font-semibold" color={titleColor}>
            {attachment.name}
          </Text>
          <Text numberOfLines={1} className="text-[12px]" color={metaColor}>
            {meta}
          </Text>
        </View>
      </Pressable>
      {failed || loadFailed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={failed ? 'Retry upload' : 'Retry loading'}
          onPress={onRetry}
          className="h-8 w-8 shrink-0 items-center justify-center rounded-full active:bg-surface"
        >
          <RotateCcw size={16} color={retryColor} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** "3.9 KB PDF": the size plus the upper-case extension, Telegram-style. */
function sizeTypeOf(attachment: Attachment): string {
  const extension = extensionOf(attachment.name);
  return [formatFileSize(attachment.size), extension].filter((part) => part !== '').join(' ');
}

/** The upper-case extension of a file name, or '' when it has none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return '';
  }
  return name.slice(dot + 1).toUpperCase();
}
