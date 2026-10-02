import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Attachment } from '@zilar/protocol';

import { Text } from '@/components/ui/text';
import { well } from '@/lib/depth';
import type { PickedFile } from '@/lib/attachment-ports';

export type AttachmentChoice = 'library' | 'camera' | 'file';

type AttachSheetProps = {
  open: boolean;
  busy: boolean;
  error?: string | undefined;
  preview?: { uri: string; name: string; size?: number | undefined } | undefined;
  /** Demo attachments listed in mock mode, so the flow works without a server. */
  demoAttachments?: Attachment[] | undefined;
  onPick: (choice: AttachmentChoice) => void;
  /** Fills the preview row with a demo attachment (mock mode only). */
  onPickDemo?: ((attachment: Attachment) => void) | undefined;
  onCancelPick?: (() => void) | undefined;
  onClose: () => void;
};

function PreviewThumb({ preview }: { preview: { uri: string; name: string } }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View className="h-16 w-16 items-center justify-center rounded-[10px] bg-surface-raised">
        <Text className="text-[22px] leading-none">📎</Text>
      </View>
    );
  }
  return (
    <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-[10px] bg-surface-raised">
      <Image
        source={{ uri: preview.uri }}
        accessibilityLabel={preview.name}
        onError={() => setFailed(true)}
        style={{ width: 64, height: 64 }}
        resizeMode="cover"
      />
    </View>
  );
}

/**
 * The paperclip bottom sheet (T-0150): Photo or video from the library, Take
 * a photo, File. A picked file shows a preview row (thumbnail, name, size)
 * with the caption the composer holds; Send uploads it through the store.
 * Permission denials and oversized files show a plain explanation, never a
 * crash. Pure view like `StickerPanel`: the composer owns the picking.
 */
export function AttachSheet({
  open,
  busy,
  error,
  preview,
  demoAttachments,
  onPick,
  onPickDemo,
  onCancelPick,
  onClose,
}: AttachSheetProps) {
  const insets = useSafeAreaInsets();
  if (!open) {
    return null;
  }
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close attachments"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable
          onPress={() => {}}
          accessibilityRole="menu"
          accessibilityLabel="Attach"
          className="rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
          <Text
            accessibilityRole="header"
            className="py-2 text-[17px] font-semibold text-foreground"
          >
            Attach
          </Text>
          {preview === undefined ? (
            <>
              <SheetRow
                label="Photo or video"
                hint="From your library"
                onPress={() => onPick('library')}
                busy={busy}
              />
              <SheetRow
                label="Take a photo"
                hint="With your camera"
                onPress={() => onPick('camera')}
                busy={busy}
              />
              <SheetRow
                label="File"
                hint="Any document"
                onPress={() => onPick('file')}
                busy={busy}
              />
              {(demoAttachments ?? []).length > 0 && onPickDemo !== undefined ? (
                <View className="pt-1">
                  <Text className="px-1 py-1 text-[13px] font-semibold text-muted-foreground">
                    Try one (demo)
                  </Text>
                  {(demoAttachments ?? []).map((attachment) => (
                    <Pressable
                      key={attachment.url}
                      accessibilityRole="button"
                      accessibilityLabel={`Attach demo ${attachment.name}`}
                      disabled={busy}
                      onPress={() => onPickDemo(attachment)}
                      className="flex-row items-center gap-3 px-1 py-2 active:bg-surface-raised disabled:opacity-60"
                    >
                      <Text className="text-[16px] leading-none">
                        {attachment.kind === 'image' ? '🖼' : '📎'}
                      </Text>
                      <Text
                        numberOfLines={1}
                        className="min-w-0 flex-1 text-[15px] text-foreground"
                      >
                        {attachment.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <PickedPreview preview={preview} busy={busy} onCancelPick={onCancelPick} />
          )}
          {busy ? (
            <View className="flex-row items-center gap-2 px-1 py-3">
              <ActivityIndicator accessibilityLabel="Preparing file" />
              <Text className="text-[13px] text-muted-foreground">Preparing…</Text>
            </View>
          ) : null}
          {error !== undefined && error !== '' ? (
            <Text role="alert" className="px-1 py-2 text-[13px] text-danger">
              {error}
            </Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetRow({
  label,
  hint,
  onPress,
  busy,
}: {
  label: string;
  hint: string;
  onPress: () => void;
  busy: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      className="flex-row items-center gap-3 border-b border-divider px-1 py-3.5 active:bg-surface-raised disabled:opacity-60"
    >
      <View className="h-9 w-9 items-center justify-center rounded-[8px] bg-surface-raised">
        <Text className="text-[16px] leading-none">
          {label.startsWith('Photo') ? '🖼' : label.startsWith('Take') ? '📷' : '📎'}
        </Text>
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[16px] text-foreground">{label}</Text>
        <Text className="text-[13px] text-muted-foreground">{hint}</Text>
      </View>
    </Pressable>
  );
}

function PickedPreview({
  preview,
  busy,
  onCancelPick,
}: {
  preview: { uri: string; name: string; size?: number | undefined };
  busy: boolean;
  onCancelPick?: (() => void) | undefined;
}) {
  return (
    <View className="flex-row items-center gap-3 rounded-[10px] px-1 py-2" style={well}>
      <PreviewThumb preview={preview} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
          {preview.name}
        </Text>
        <Text className="text-[13px] text-muted-foreground">
          {preview.size === undefined
            ? 'Sending with your message'
            : formatPreviewSize(preview.size)}
        </Text>
      </View>
      {onCancelPick === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove attachment"
          disabled={busy}
          onPress={onCancelPick}
          className="rounded-[8px] px-3 py-2 active:bg-surface-raised disabled:opacity-60"
        >
          <Text className="text-[14px] font-semibold text-muted-foreground">Remove</Text>
        </Pressable>
      )}
    </View>
  );
}

function formatPreviewSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'Sending with your message';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B · sending with your message`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]} · sending with your message`;
}

/** The picked file the sheet preview shows, for tests. */
export type SheetPreview = Pick<PickedFile, 'uri' | 'name' | 'size'>;
