import { Paperclip } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Attachment } from '@zilar/protocol';

import { AttachTabBar, type AttachTab } from '@/components/chat/attach/attach-tab-bar';
import { FileTab } from '@/components/chat/attach/file-tab';
import { GalleryTab } from '@/components/chat/attach/gallery-tab';
import { useGalleryAssets } from '@/components/chat/attach/use-gallery-assets';
import { useSheetMotion } from '@/components/chat/sheet-motion';
import { Text } from '@/components/ui/text';
import type { PickedFile } from '@/lib/attachment-ports';
import { ICON } from '@/lib/colors';

export type AttachmentChoice = 'library' | 'camera' | 'file';

type AttachSheetProps = {
  open: boolean;
  busy: boolean;
  error?: string | undefined;
  demoAttachments?: Attachment[] | undefined;
  onPick: (choice: AttachmentChoice) => void;
  onPickDemo?: ((attachment: Attachment) => void) | undefined;
  onSendFiles: (files: PickedFile[]) => void;
  onClose: () => void;
};

export function AttachSheet({ open, onClose, ...props }: AttachSheetProps) {
  if (!open) {
    return null;
  }
  return <AttachSheetBody onClose={onClose} {...props} />;
}

/** Split out so closing unmounts it and clears the tab, selection and gallery page. */
function AttachSheetBody({
  busy,
  error,
  demoAttachments,
  onPick,
  onPickDemo,
  onSendFiles,
  onClose,
}: Omit<AttachSheetProps, 'open'>) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<AttachTab>('gallery');
  const gallery = useGalleryAssets();
  const { panelStyle, onLayout, close, dragGesture } = useSheetMotion(onClose);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      {/* Gestures do not fire inside an RN `Modal` on Android without a root. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable
          accessibilityLabel="Close attachments"
          onPress={close}
          className="flex-1 justify-end bg-black/40"
        >
          <Animated.View className="h-[75%]" onLayout={onLayout} style={panelStyle}>
            <Pressable
              onPress={() => {}}
              accessibilityRole="menu"
              accessibilityLabel="Attach"
              className="flex-1 rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
              style={{ paddingBottom: Math.max(insets.bottom, 8) }}
            >
              <GestureDetector gesture={dragGesture}>
                <View className="py-2">
                  <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
                  <View className="flex-row items-center gap-2 py-2">
                    <Paperclip size={20} color={ICON} />
                    <Text
                      accessibilityRole="header"
                      className="text-[17px] font-semibold text-foreground"
                    >
                      Attach
                    </Text>
                  </View>
                </View>
              </GestureDetector>
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
                {/* The gallery stays mounted while the File tab shows, so its
                  page and the selection survive a tab switch. */}
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
                    onSendFiles={onSendFiles}
                  />
                </View>
                {tab === 'file' ? <FileTab busy={busy} onPick={onPick} /> : null}
              </View>
              <AttachTabBar active={tab} onSelect={setTab} />
            </Pressable>
          </Animated.View>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}
