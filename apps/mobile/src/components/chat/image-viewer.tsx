import { parseUrl, type ViewerPhoto } from '@zilar/chat-core';
import { Download, X } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useMediaSource } from '@/lib/media-source';
import { SAVE_FAILED_MESSAGE, SAVED_MESSAGE, savePhoto } from '@/lib/save-photo';
import { PhotoPager } from './photo-pager';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type AttachmentViewerProps = {
  /** The message's chat, for the `GET /api/files` proxy URL (T-1185). */
  chatId: string;
  /** The chat's photos, in message order; a swipe steps through them. */
  photos: ViewerPhoto[];
  /** The index of the photo this viewer opens on. */
  startIndex: number;
  /** The store's trusted media hosts; a photo off them is shown blank. */
  trustedHosts: ReadonlySet<string>;
  onClose: () => void;
};

/** The viewer URL: only a trusted http(s) URL, never user-supplied schemes. */
function viewableUrl(url: string, hosts: ReadonlySet<string>): string | undefined {
  const parsed = parseUrl(url);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }
  return hosts.has(parsed.hostname.toLowerCase()) ? url : undefined;
}

/**
 * The full-screen photo viewer (T-1256): a "3 / 12" counter, a horizontal swipe
 * that steps through the chat's photos, pinch/pan/double-tap zoom and
 * swipe-down to dismiss, plus a Save button that stores the photo on screen in
 * the phone's gallery. The modal content has its own `GestureHandlerRootView`:
 * gestures don't fire inside an RN `Modal` on Android without one. A photo off
 * the trusted hosts is shown blank: its bytes are never fetched.
 */
export function AttachmentViewer({
  chatId,
  photos,
  startIndex,
  trustedHosts,
  onClose,
}: AttachmentViewerProps) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, startIndex), Math.max(0, photos.length - 1)),
  );
  const [save, setSave] = useState<{ index: number; state: SaveState }>({
    index: 0,
    state: 'idle',
  });
  const photo = photos[index];
  // The bytes go through `GET /api/files` (with the bearer) when this is our
  // own `/upload/` file; an untrusted or non-http(s) URL stays undefined and
  // renders a blank tile.
  const url = photo === undefined ? undefined : viewableUrl(photo.url, trustedHosts);
  const source = useMediaSource(chatId, url ?? '', url !== undefined);
  // A save line belongs to the photo it was started on, so stepping to the next
  // photo hides it without an effect.
  const saveState = save.index === index ? save.state : 'idle';

  if (photo === undefined) {
    return null;
  }

  const step = (delta: number): void => {
    setIndex((current) => Math.min(photos.length - 1, Math.max(0, current + delta)));
  };

  const onSave = (): void => {
    if (source === undefined || saveState === 'saving') {
      return;
    }
    setSave({ index, state: 'saving' });
    savePhoto(source, (result) => {
      setSave({ index, state: result.status === 'saved' ? 'saved' : 'error' });
    });
  };

  const message =
    saveState === 'saved' ? SAVED_MESSAGE : saveState === 'error' ? SAVE_FAILED_MESSAGE : undefined;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <PhotoPager
          key={index}
          source={source}
          accessibilityLabel={photo.alt}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onClose={onClose}
        />
        <View
          style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12 }}
          className="flex-row items-center justify-between"
        >
          <View className="rounded-full bg-black/50 px-2.5 py-1">
            <Text className="font-mono text-[13px] tabular-nums text-white">
              {index + 1} / {photos.length}
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save photo"
              disabled={source === undefined || saveState === 'saving'}
              onPress={onSave}
              className="items-center justify-center rounded-full bg-surface p-2 active:opacity-80"
            >
              <Download size={22} color="#ffffff" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close viewer"
              onPress={onClose}
              className="items-center justify-center rounded-full bg-surface p-2 active:opacity-80"
            >
              <X size={22} color="#ffffff" />
            </Pressable>
          </View>
        </View>
        {message !== undefined ? (
          <View
            style={{ position: 'absolute', top: insets.top + 56, left: 24, right: 24 }}
            className="items-center"
          >
            <Text className="text-[13px] text-white/90">{message}</Text>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}
