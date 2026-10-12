import { Image } from 'expo-image';
import { useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { MediaSource } from '@/lib/media-source';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;
const SWIPE_DISTANCE = 60;
const SWIPE_VELOCITY = 500;

/** The mutable zoom/pan/dismiss/swipe state, owned by the pager component. */
type PagerMotion = {
  scale: SharedValue<number>;
  savedScale: SharedValue<number>;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  savedX: SharedValue<number>;
  savedY: SharedValue<number>;
  swipeX: SharedValue<number>;
  dismissY: SharedValue<number>;
  backdrop: SharedValue<number>;
  /** The drag axis: 0 undecided, 1 horizontal (steps photos), 2 vertical. */
  axis: SharedValue<number>;
};

/** Clamps a pan offset so the zoomed image can't leave the screen. */
function clampPan(value: number, limit: number): number {
  'worklet';
  return Math.min(limit, Math.max(-limit, value));
}

/** Pinch zooms 1–4x, re-clamping the pan to the new zoom level. */
function makePinch(motion: PagerMotion, width: number, height: number) {
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
 * Pan moves the image while zoomed (clamped to the screen). At 1x the first
 * movement picks an axis: a horizontal drag steps to the next or previous
 * photo, a vertical drag moves the image and fades the backdrop, closing past
 * ~120 px or a fast fling and springing back otherwise.
 */
function makePan(
  motion: PagerMotion,
  width: number,
  height: number,
  onPrev: () => void,
  onNext: () => void,
  onClose: () => void,
) {
  return Gesture.Pan()
    .onStart(() => {
      motion.savedX.value = motion.translateX.value;
      motion.savedY.value = motion.translateY.value;
      motion.axis.value = 0;
    })
    .onUpdate((event) => {
      if (motion.scale.value > MIN_SCALE) {
        const limitX = ((motion.scale.value - MIN_SCALE) * width) / 2;
        const limitY = ((motion.scale.value - MIN_SCALE) * height) / 2;
        motion.translateX.value = clampPan(motion.savedX.value + event.translationX, limitX);
        motion.translateY.value = clampPan(motion.savedY.value + event.translationY, limitY);
        return;
      }
      if (motion.axis.value === 0) {
        motion.axis.value = Math.abs(event.translationX) > Math.abs(event.translationY) ? 1 : 2;
      }
      if (motion.axis.value === 1) {
        motion.swipeX.value = event.translationX;
      } else {
        motion.dismissY.value = event.translationY;
        motion.backdrop.value = 1 - Math.min(Math.abs(event.translationY) / 300, 0.6);
      }
    })
    .onEnd((event) => {
      if (motion.scale.value > MIN_SCALE) {
        return;
      }
      if (motion.axis.value === 1) {
        const next = event.translationX < -SWIPE_DISTANCE || event.velocityX < -SWIPE_VELOCITY;
        const previous = event.translationX > SWIPE_DISTANCE || event.velocityX > SWIPE_VELOCITY;
        motion.swipeX.value = withTiming(0);
        if (next) {
          runOnJS(onNext)();
        } else if (previous) {
          runOnJS(onPrev)();
        }
      } else if (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        runOnJS(onClose)();
      } else {
        motion.dismissY.value = withSpring(0);
        motion.backdrop.value = withTiming(1);
      }
    });
}

/** Double-tap zooms to 2.5x at 1x, back to 1x otherwise, animated. */
function makeDoubleTap(motion: PagerMotion) {
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

type PhotoPagerProps = {
  /** The photo source to show, or undefined while it is blank/unresolved. */
  source: MediaSource | undefined;
  accessibilityLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
};

/**
 * The zoomable photo surface of the viewer: a horizontal swipe at 1x steps
 * photos, pinch-to-zoom, pan while zoomed, double-tap to zoom and swipe-down to
 * dismiss, all on the UI thread through reanimated shared values (no `setState`
 * per frame). Plain `Image`, so GIF/WebP animate as in the bubble.
 */
export function PhotoPager({
  source,
  accessibilityLabel,
  onPrev,
  onNext,
  onClose,
}: PhotoPagerProps) {
  const { width, height } = useWindowDimensions();
  const scale = useSharedValue(MIN_SCALE);
  const savedScale = useSharedValue(MIN_SCALE);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const swipeX = useSharedValue(0);
  const dismissY = useSharedValue(0);
  const backdrop = useSharedValue(1);
  const axis = useSharedValue(0);
  const motion: PagerMotion = {
    scale,
    savedScale,
    translateX,
    translateY,
    savedX,
    savedY,
    swipeX,
    dismissY,
    backdrop,
    axis,
  };
  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value + swipeX.value },
      { translateY: translateY.value + dismissY.value },
      { scale: scale.value },
    ],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const pinch = makePinch(motion, width, height);
  const pan = makePan(motion, width, height, onPrev, onNext, onClose);
  const doubleTap = makeDoubleTap(motion);

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' }, backdropStyle]}>
      <GestureDetector gesture={Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan))}>
        <Animated.View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[imageStyle, { width: '100%', height: '100%' }]}>
            <Image
              source={source ?? null}
              accessibilityLabel={accessibilityLabel}
              contentFit="contain"
              style={{ width: '100%', height: '100%' }}
            />
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}
