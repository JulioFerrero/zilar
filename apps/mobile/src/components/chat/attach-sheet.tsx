import { Camera, FileText, Image as ImageIcon, Paperclip } from 'lucide-react-native';
import { type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Attachment } from '@zilar/protocol';

import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';

export type AttachmentChoice = 'library' | 'camera' | 'file';

type AttachSheetProps = {
  open: boolean;
  busy: boolean;
  error?: string | undefined;
  /** Demo attachments listed in mock mode, so the flow works without a server. */
  demoAttachments?: Attachment[] | undefined;
  onPick: (choice: AttachmentChoice) => void;
  /** Stages a demo attachment (mock mode only). */
  onPickDemo?: ((attachment: Attachment) => void) | undefined;
  onClose: () => void;
};

/**
 * The paperclip bottom sheet (T-0150): Photo or video from the library, Take
 * a photo, File. Picking stages the files in the composer's strip (T-1246),
 * which sends them; permission denials and oversized files show a plain
 * explanation, never a crash. Pure view like `StickerPanel`: the composer
 * owns the picking.
 */
export function AttachSheet({
  open,
  busy,
  error,
  demoAttachments,
  onPick,
  onPickDemo,
  onClose,
}: AttachSheetProps) {
  const insets = useSafeAreaInsets();
  const iconColor = ICON;
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
          <View className="flex-row items-center gap-2 py-2">
            <Paperclip size={20} color={iconColor} />
            <Text accessibilityRole="header" className="text-[17px] font-semibold text-foreground">
              Attach
            </Text>
          </View>
          <SheetRow
            label="Photo or video"
            hint="From your library"
            onPress={() => onPick('library')}
            busy={busy}
            icon={<ImageIcon size={20} color={iconColor} />}
          />
          <SheetRow
            label="Take a photo"
            hint="With your camera"
            onPress={() => onPick('camera')}
            busy={busy}
            icon={<Camera size={20} color={iconColor} />}
          />
          <SheetRow
            label="File"
            hint="Any document"
            onPress={() => onPick('file')}
            busy={busy}
            icon={<FileText size={20} color={iconColor} />}
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
                  <View className="h-9 w-9 items-center justify-center rounded-[8px] bg-surface-raised">
                    {attachment.kind === 'image' ? (
                      <ImageIcon size={20} color={iconColor} />
                    ) : (
                      <FileText size={20} color={iconColor} />
                    )}
                  </View>
                  <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] text-foreground">
                    {attachment.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
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
  icon,
}: {
  label: string;
  hint: string;
  onPress: () => void;
  busy: boolean;
  icon: ReactNode;
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
        {icon}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[16px] text-foreground">{label}</Text>
        <Text className="text-[13px] text-muted-foreground">{hint}</Text>
      </View>
    </Pressable>
  );
}
