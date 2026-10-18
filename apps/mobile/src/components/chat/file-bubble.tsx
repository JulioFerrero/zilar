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
  outgoing?: boolean | undefined;
  trusted?: boolean | undefined;
  uploading?: boolean | undefined;
  progress?: number | undefined;
  failed?: boolean | undefined;
  loadFailed?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
  opening?: boolean | undefined;
};

/** The bytes are never fetched automatically: `onOpen` runs only on tap. An
 *  untrusted address shows the untrusted line, never size and type. */
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

function sizeTypeOf(attachment: Attachment): string {
  const extension = extensionOf(attachment.name);
  return [formatFileSize(attachment.size), extension].filter((part) => part !== '').join(' ');
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return '';
  }
  return name.slice(dot + 1).toUpperCase();
}
