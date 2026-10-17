import { parseUrl, type ViewerPhoto } from '@zilar/chat-core';
import { Image } from 'expo-image';
import { Download, Share2, X } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  clamp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gallery, type VerticalPullOptions } from 'react-native-zoom-toolkit';

import { Text } from '@/components/ui/text';
import { useMediaSource } from '@/lib/media-source';
import { SAVE_FAILED_MESSAGE, SAVED_MESSAGE, savePhoto } from '@/lib/save-photo';
import { SHARE_FAILED_MESSAGE, sharePhoto } from '@/lib/share-photo';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type ShareState = 'idle' | 'sharing' | 'error';

/** A downward pull past this many pixels closes the viewer on release. */
const CLOSE_DISTANCE = 120;
/** A downward flick faster than this closes the viewer even under the distance. */
const CLOSE_VELOCITY = 800;
/** The pull distance over which the backdrop fades from opaque to its floor. */
const PULL_FADE = 500;
const MIN_BACKDROP_OPACITY = 0.4;

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

/** The shared values the Gallery's vertical-pull callbacks read and write. */
type ViewerMotion = {
  pullY: SharedValue<number>;
  closing: SharedValue<boolean>;
};

/**
 * Handles the Gallery's vertical pull on the UI thread: it nudges the backdrop
 * to follow the finger and closes the viewer once the finger is released past
 * the distance or flick threshold. `closing` makes `onClose` fire a single time
 * while the pulled photo animates back.
 */
function applyVerticalPull(
  motion: ViewerMotion,
  options: VerticalPullOptions,
  onClose: () => void,
): void {
  'worklet';
  motion.pullY.value = options.translateY;
  if (motion.closing.value) {
    return;
  }
  if (
    options.released &&
    (options.translateY > CLOSE_DISTANCE || options.velocityY > CLOSE_VELOCITY)
  ) {
    motion.closing.value = true;
    runOnJS(onClose)();
  }
}

type ViewerImageProps = {
  chatId: string;
  photo: ViewerPhoto;
  trustedHosts: ReadonlySet<string>;
  width: number;
  height: number;
};

/**
 * One Gallery item: the photo at the screen size with `contain`. Its bytes go
 * through `GET /api/files` (with the bearer) when this is our own `/upload/`
 * file; an untrusted or non-http(s) URL stays undefined and renders blank.
 */
function ViewerImage({ chatId, photo, trustedHosts, width, height }: ViewerImageProps) {
  const url = viewableUrl(photo.url, trustedHosts);
  const source = useMediaSource(chatId, url ?? '', url !== undefined);
  return (
    <Image
      recyclingKey={photo.messageId}
      source={source ?? null}
      accessibilityLabel={photo.alt}
      contentFit="contain"
      style={{ width, height }}
    />
  );
}

/**
 * The full-screen photo viewer (T-1341) on `react-native-zoom-toolkit`'s
 * `Gallery`: a swipe carousel with per-photo pinch, pan and double-tap zoom,
 * a "3 / 12" counter, a Save button that stores the photo on screen in the
 * phone's gallery, a Share button that opens the system share sheet with it,
 * and a pull-down to dismiss. A single tap toggles the
 * overlay. The modal content has its own `GestureHandlerRootView`: gestures
 * don't fire inside an RN `Modal` on Android without one. A photo off the
 * trusted hosts is shown blank: its bytes are never fetched.
 */
export function AttachmentViewer({
  chatId,
  photos,
  startIndex,
  trustedHosts,
  onClose,
}: AttachmentViewerProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, startIndex), Math.max(0, photos.length - 1)),
  );
  const [chrome, setChrome] = useState(true);
  const [save, setSave] = useState<{ index: number; state: SaveState }>({
    index: 0,
    state: 'idle',
  });
  const [share, setShare] = useState<{ index: number; state: ShareState }>({
    index: 0,
    state: 'idle',
  });
  const pullY = useSharedValue(0);
  const closing = useSharedValue(false);
  // A plain object so the worklets read and write the shared values through it;
  // its members are stable across renders.
  const motion = useMemo<ViewerMotion>(() => ({ pullY, closing }), [pullY, closing]);
  const photo = photos[index];
  // The bytes go through `GET /api/files` (with the bearer) when this is our
  // own `/upload/` file; an untrusted or non-http(s) URL stays undefined and
  // the Save button stays disabled.
  const url = photo === undefined ? undefined : viewableUrl(photo.url, trustedHosts);
  const source = useMediaSource(chatId, url ?? '', url !== undefined);
  // A save or share line belongs to the photo it was started on, so stepping to
  // the next photo hides it without an effect.
  const saveState = save.index === index ? save.state : 'idle';
  const shareState = share.index === index ? share.state : 'idle';

  const handleIndexChange = useCallback((next: number) => setIndex(next), []);
  const handleTap = useCallback(() => setChrome((visible) => !visible), []);

  // A worklet: the Gallery reports the pull on the UI thread.
  const handleVerticalPull = useCallback(
    (options: VerticalPullOptions) => {
      'worklet';
      applyVerticalPull(motion, options, onClose);
    },
    [motion, onClose],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: clamp(1 - Math.abs(motion.pullY.value) / PULL_FADE, MIN_BACKDROP_OPACITY, 1),
  }));

  const renderItem = useCallback(
    (item: ViewerPhoto) => (
      <ViewerImage
        chatId={chatId}
        photo={item}
        trustedHosts={trustedHosts}
        width={width}
        height={height}
      />
    ),
    [chatId, trustedHosts, width, height],
  );

  const keyExtractor = useCallback((item: ViewerPhoto) => item.messageId, []);

  if (photo === undefined) {
    return null;
  }

  const onSave = (): void => {
    if (source === undefined || saveState === 'saving') {
      return;
    }
    setShare({ index, state: 'idle' });
    setSave({ index, state: 'saving' });
    savePhoto(source, (result) => {
      setSave({ index, state: result.status === 'saved' ? 'saved' : 'error' });
    });
  };

  const onShare = (): void => {
    if (source === undefined || shareState === 'sharing') {
      return;
    }
    setSave({ index, state: 'idle' });
    setShare({ index, state: 'sharing' });
    sharePhoto(source, (result) => {
      setShare({ index, state: result.status === 'shared' ? 'idle' : 'error' });
    });
  };

  const message =
    shareState === 'error'
      ? SHARE_FAILED_MESSAGE
      : saveState === 'saved'
        ? SAVED_MESSAGE
        : saveState === 'error'
          ? SAVE_FAILED_MESSAGE
          : undefined;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: '#000000' }, backdropStyle]}
        />
        <Gallery
          data={photos}
          initialIndex={startIndex}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          onIndexChange={handleIndexChange}
          onTap={handleTap}
          onVerticalPull={handleVerticalPull}
        />
        {chrome ? (
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
                accessibilityLabel="Share photo"
                disabled={source === undefined || shareState === 'sharing'}
                onPress={onShare}
                className="items-center justify-center rounded-full bg-surface p-2 active:opacity-80"
              >
                <Share2 size={22} color="#ffffff" />
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
        ) : null}
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
