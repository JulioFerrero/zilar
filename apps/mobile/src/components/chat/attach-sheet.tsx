import { Paperclip } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Attachment } from '@zilar/protocol';

import { AttachTabBar, type AttachTab } from '@/components/chat/attach/attach-tab-bar';
import { FileTab } from '@/components/chat/attach/file-tab';
import { GalleryTab } from '@/components/chat/attach/gallery-tab';
import { useGalleryAssets } from '@/components/chat/attach/use-gallery-assets';
import { Text } from '@/components/ui/text';
import type { PickedFile } from '@/lib/attachment-ports';
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
  /** Stages the gallery's picked files in the composer strip (T-1320). */
  onStageFiles: (files: PickedFile[]) => void;
  onClose: () => void;
};

/**
 * The paperclip bottom sheet (T-0150, T-1320): a bottom tab bar Gallery | File.
 * The Gallery tab is the phone's recent photos and videos in a 3-column grid
 * with a live camera tile and multi-select ("Send N"), reading
 * `expo-media-library`; the File tab keeps today's document picker. Picking
 * stages the files in the composer's strip (T-1246), which sends them; the
 * composer owns the picking.
 */
export function AttachSheet({ open, onClose, ...props }: AttachSheetProps) {
  if (!open) {
    return null;
  }
  return <AttachSheetBody onClose={onClose} {...props} />;
}

/**
 * The open sheet's body. Split out so closing unmounts it and clears the tab,
 * the selection and the loaded gallery page (the `open` early return above
 * cannot run hooks).
 */
function AttachSheetBody({
  busy,
  error,
  demoAttachments,
  onPick,
  onPickDemo,
  onStageFiles,
  onClose,
}: Omit<AttachSheetProps, 'open'>) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<AttachTab>('gallery');
  const gallery = useGalleryAssets();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close attachments"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable
          onPress={() => {}}
          accessibilityRole="menu"
          accessibilityLabel="Attach"
          className="h-[75%] rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
          <View className="flex-row items-center gap-2 py-2">
            <Paperclip size={20} color={ICON} />
            <Text accessibilityRole="header" className="text-[17px] font-semibold text-foreground">
              Attach
            </Text>
          </View>
          {busy ? (
            <View className="flex-row items-center gap-2 px-1 py-1">
              <ActivityIndicator accessibilityLabel="Preparing file" />
              <Text className="text-[13px] text-muted-foreground">Preparing…</Text>
            </View>
          ) : null}
          {error !== undefined && error !== '' ? (
            <Text role="alert" className="px-1 py-1 text-[13px] text-danger">
              {error}
            </Text>
          ) : null}
          <View className="min-h-0 flex-1">
            {/* The gallery stays mounted while the File tab shows, so its page
                and the selection survive a tab switch. */}
            <View
              className="min-h-0 flex-1"
              style={tab === 'gallery' ? undefined : { display: 'none' }}
            >
              <GalleryTab
                gallery={gallery}
                busy={busy}
                demoAttachments={demoAttachments}
                onPick={onPick}
                onPickDemo={onPickDemo}
                onStageFiles={onStageFiles}
              />
            </View>
            {tab === 'file' ? <FileTab busy={busy} onPick={onPick} /> : null}
          </View>
          <AttachTabBar active={tab} onSelect={setTab} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
