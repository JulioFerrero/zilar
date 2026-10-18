import {
  Paperclip,
  File as FileIcon,
  Image as ImageIcon,
  type LucideIcon,
  FileText,
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Attachment } from '@zilar/protocol';
import { GalleryTab } from '@/components/chat/attach/gallery-tab';
import { useGalleryAssets } from '@/components/chat/attach/use-gallery-assets';
import { useSheetMotion } from '@/components/chat/sheet-motion';
import { Text } from '@/components/ui/text';
import type { PickedFile } from '@/lib/attachment-ports';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { segment } from '@/lib/depth';

/**
 * The File tab: today's document picker behind "Browse files". The
 * Telegram row "Send photos as files" is deliberately absent: the send path
 * takes the kind from the file's MIME (`classifyMobileFile` /
 * `attachmentDataFor`), so a photo cannot be forced to `kind: 'file'` without
 * changing the store's bytes port (`apps/mobile/src/store/effects/ports.ts`).
 */
function FileTab({ busy, onPick }: { busy: boolean; onPick: (choice: AttachmentChoice) => void }) {
  const iconColor = ICON;
  return (
    <View className="pt-1">
      <FileRow
        label="Browse files"
        hint="Any document"
        onPress={() => onPick('file')}
        busy={busy}
        icon={<FileText size={20} color={iconColor} />}
      />
    </View>
  );
}

function FileRow({
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

/** The two tabs of the attach sheet: the inline gallery and files. */
type AttachTab = 'gallery' | 'file';

const TABS: { id: AttachTab; label: string; Icon: LucideIcon }[] = [
  { id: 'gallery', label: 'Gallery', Icon: ImageIcon },
  { id: 'file', label: 'File', Icon: FileIcon },
];

/**
 * The sheet's bottom tab bar: Gallery | File, lucide icons, and the active
 * pill look of the main floating tab bar (`segment`). The face is keyed by its
 * look, so Android rebuilds it instead of swapping the gradient on a live view
 * (`gradient-swap.test.ts`).
 */
function AttachTabBar({
  active,
  onSelect,
}: {
  active: AttachTab;
  onSelect: (tab: AttachTab) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Attachment tabs"
      className="flex-row gap-1 border-t border-divider pt-2"
    >
      {TABS.map(({ id, label, Icon }) => {
        const selected = active === id;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => onSelect(id)}
            className="flex-1 items-center justify-center rounded-[10px] py-1 active:bg-surface-raised"
          >
            <View
              key={selected ? 'active' : 'idle'}
              className="flex-row items-center gap-1.5 rounded-[8px] px-3 py-1.5"
              {...(selected ? { style: segment } : {})}
            >
              <Icon size={16} color={selected ? '#ededed' : ICON} />
              <Text
                className="text-[13px] font-medium"
                style={{ color: selected ? '#ededed' : MUTED_FOREGROUND }}
              >
                {label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

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
