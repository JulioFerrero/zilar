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

const CLOSE_DISTANCE = 120;
const CLOSE_VELOCITY = 800;
const PULL_FADE = 500;
const MIN_BACKDROP_OPACITY = 0.4;

type AttachmentViewerProps = {
  chatId: string;
  photos: ViewerPhoto[];
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

type ViewerMotion = {
  pullY: SharedValue<number>;
  closing: SharedValue<boolean>;
};

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

/** Our own `/upload/` file goes through `GET /api/files` so it carries the bearer. */
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

/** The modal content needs its own `GestureHandlerRootView`: gestures do not
 *  fire inside an RN `Modal` on Android without one. */
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
  const motion = useMemo<ViewerMotion>(() => ({ pullY, closing }), [pullY, closing]);
  const photo = photos[index];
  const url = photo === undefined ? undefined : viewableUrl(photo.url, trustedHosts);
  const source = useMediaSource(chatId, url ?? '', url !== undefined);
  const saveState = save.index === index ? save.state : 'idle';
  const shareState = share.index === index ? share.state : 'idle';

  const handleIndexChange = useCallback((next: number) => setIndex(next), []);
  const handleTap = useCallback(() => setChrome((visible) => !visible), []);

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
