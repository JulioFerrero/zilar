import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { Modal, Pressable, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMediaSource } from '@/lib/media-source';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

/** The mutable zoom/pan/dismiss state, owned by the viewer component. */
type ViewerMotion = {
  scale: SharedValue<number>;
  savedScale: SharedValue<number>;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  savedX: SharedValue<number>;
  savedY: SharedValue<number>;
  dismissY: SharedValue<number>;
  backdrop: SharedValue<number>;
};

type AttachmentViewerProps = {
  /** The message's chat, for the `GET /api/files` proxy URL (T-1185). */
  chatId: string;
  /** The image URL to show full-screen, or undefined when closed. */
  url: string | undefined;
  name: string;
  onClose: () => void;
};

/** Clamps a pan offset so the zoomed image can't leave the screen. */
function clampPan(value: number, limit: number): number {
  'worklet';
  return Math.min(limit, Math.max(-limit, value));
}

/** Pinch zooms 1–4x, re-clamping the pan to the new zoom level. */
function makePinch(motion: ViewerMotion, width: number, height: number) {
  return Gesture.Pinch()
    .onStart(() => {
      motion.savedScale.value = motion.scale.value;
    })
    .onUpdate((event) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, motion.savedScale.value * event.scale));
      motion.scale.value = next;
      motion.translateX.value = clampPan(motion.translateX.value, ((next - MIN_SCALE) * width) / 2);
      motion.translateY.value = clampPan(
        motion.translateY.value,
        ((next - MIN_SCALE) * height) / 2,
      );
    });
}

/**
 * Pan moves the image while zoomed (clamped to the screen). At 1x a vertical
 * drag moves the image and fades the backdrop; past ~120 px or a fast fling
 * it closes, otherwise it springs back.
 */
function makePan(motion: ViewerMotion, width: number, height: number, onClose: () => void) {
  return Gesture.Pan()
    .onStart(() => {
      motion.savedX.value = motion.translateX.value;
      motion.savedY.value = motion.translateY.value;
    })
    .onUpdate((event) => {
      if (motion.scale.value > MIN_SCALE) {
        const limitX = ((motion.scale.value - MIN_SCALE) * width) / 2;
        const limitY = ((motion.scale.value - MIN_SCALE) * height) / 2;
        motion.translateX.value = clampPan(motion.savedX.value + event.translationX, limitX);
        motion.translateY.value = clampPan(motion.savedY.value + event.translationY, limitY);
      } else {
        motion.dismissY.value = event.translationY;
        motion.backdrop.value = 1 - Math.min(Math.abs(event.translationY) / 300, 0.6);
      }
    })
    .onEnd((event) => {
      if (motion.scale.value <= MIN_SCALE) {
        if (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
          runOnJS(onClose)();
        } else {
          motion.dismissY.value = withSpring(0);
          motion.backdrop.value = withTiming(1);
        }
      }
    });
}

/** Double-tap zooms to 2.5x at 1x, back to 1x otherwise, animated. */
function makeDoubleTap(motion: ViewerMotion) {
  return Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (motion.scale.value > MIN_SCALE) {
        motion.scale.value = withTiming(MIN_SCALE);
        motion.translateX.value = withTiming(0);
        motion.translateY.value = withTiming(0);
      } else {
        motion.scale.value = withTiming(DOUBLE_TAP_SCALE);
      }
    });
}

/**
 * The full-screen image viewer (MUX-13): pinch-to-zoom, pan while zoomed,
 * double-tap to zoom in/out and swipe-down to dismiss, all on the UI thread
 * through reanimated shared values (no `setState` per frame). Plain `Image`,
 * so GIF/WebP animate as in the bubble. The modal content has its own
 * `GestureHandlerRootView`: gestures don't fire inside an RN `Modal` on
 * Android without one.
 */
export function AttachmentViewer({ chatId, url, name, onClose }: AttachmentViewerProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // The bytes go through `GET /api/files` (with the bearer) when this is our
  // own `/upload/` file; other origins load directly (T-1185).
  const source = useMediaSource(chatId, url ?? '', url !== undefined);
  const scale = useSharedValue(MIN_SCALE);
  const savedScale = useSharedValue(MIN_SCALE);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const dismissY = useSharedValue(0);
  const backdrop = useSharedValue(1);
  const motion: ViewerMotion = {
    scale,
    savedScale,
    translateX,
    translateY,
    savedX,
    savedY,
    dismissY,
    backdrop,
  };
  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value + dismissY.value },
      { scale: scale.value },
    ],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const pinch = makePinch(motion, width, height);
  const pan = makePan(motion, width, height, onClose);
  const doubleTap = makeDoubleTap(motion);

  if (url === undefined) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' }, backdropStyle]}>
          <GestureDetector gesture={Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan))}>
            <Animated.View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Animated.View style={[imageStyle, { width: '100%', height: '100%' }]}>
                <Image
                  source={source ?? null}
                  accessibilityLabel={name}
                  contentFit="contain"
                  style={{ width: '100%', height: '100%' }}
                />
              </Animated.View>
            </Animated.View>
          </GestureDetector>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close viewer"
            onPress={onClose}
            className="items-center justify-center rounded-full bg-surface p-2 active:opacity-80"
            style={{ position: 'absolute', top: insets.top + 8, right: 12 }}
          >
            <X size={22} color="#ffffff" />
          </Pressable>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
