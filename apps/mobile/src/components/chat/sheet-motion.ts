import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, type LayoutChangeEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

const OPEN_MS = 260;
const CLOSE_MS = 200;
const EASING = Easing.bezier(0.32, 0.72, 0, 1);
const WINDOW_HEIGHT = Dimensions.get('window').height;
/** The drag distance that dismisses, as a share of the panel's height. */
const DISMISS_RATIO = 0.3;
/** The downward speed that dismisses, in px per second. */
const DISMISS_VELOCITY = 800;

type SheetMotionValues = { offset: SharedValue<number> };

function setOffset(motion: SheetMotionValues, value: number): void {
  motion.offset.value = value;
}

function animateOpen(motion: SheetMotionValues): void {
  motion.offset.value = withTiming(0, { duration: OPEN_MS, easing: EASING });
}

function animateClose(motion: SheetMotionValues, height: number, onDone: () => void): void {
  motion.offset.value = withTiming(height, { duration: CLOSE_MS, easing: EASING }, (finished) => {
    if (finished) {
      runOnJS(onDone)();
    }
  });
}

function followFinger(motion: SheetMotionValues, translationY: number): void {
  'worklet';
  motion.offset.value = translationY > 0 ? translationY : translationY * 0.2;
}

function springBack(motion: SheetMotionValues): void {
  'worklet';
  motion.offset.value = withSpring(0, { damping: 30, stiffness: 300 });
}

function markExiting(exiting: SharedValue<boolean>): void {
  exiting.value = true;
}

function isExiting(exiting: SharedValue<boolean>): boolean {
  'worklet';
  return exiting.value;
}

/**
 * The phone sheets' motion (T-1922, T-1928): the panel slides up from the
 * bottom in 260 ms when the sheet mounts and back down in 200 ms before it
 * closes, so enter and exit take the same path as the kit `BottomSheet`.
 * `close` is idempotent while the exit runs. `dragGesture` is the pan for the
 * sheet's grabber and header: it follows the finger down (pulling up
 * rubber-bands), lets go past a third of the panel or with a quick flick to
 * dismiss through the same `close` path, and springs back otherwise. With
 * reduced motion the panel never translates on its own: it just fades with the
 * `Modal`, the drag still follows the finger, and either close calls `onClose`
 * at once. Call this from a body that mounts only while the sheet is open.
 */
export function useSheetMotion(onClose: () => void) {
  const reduceMotion = useReducedMotion();
  const offset = useSharedValue(reduceMotion ? 0 : WINDOW_HEIGHT);
  // A plain object so the animations write the shared value outside render.
  const motion = useMemo<SheetMotionValues>(() => ({ offset }), [offset]);
  const [height, setHeight] = useState(WINDOW_HEIGHT);
  const measured = useRef(false);
  // Read by the drag's worklets, so a drag that starts while the exit runs
  // cannot cancel its animation and strand the panel.
  const exiting = useSharedValue(false);

  useEffect(() => {
    if (reduceMotion) {
      setOffset(motion, 0);
      return;
    }
    animateOpen(motion);
  }, [motion, reduceMotion]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const panelHeight = event.nativeEvent.layout.height;
      if (panelHeight <= 0) {
        return;
      }
      setHeight(panelHeight);
      if (measured.current) {
        return;
      }
      measured.current = true;
      // The first frame hid the panel by the window height; restart the entry
      // from the real height so the slide travels only the panel's distance.
      if (!reduceMotion) {
        setOffset(motion, panelHeight);
        animateOpen(motion);
      }
    },
    [motion, reduceMotion],
  );

  const close = useCallback(() => {
    if (isExiting(exiting)) {
      return;
    }
    markExiting(exiting);
    if (reduceMotion) {
      onClose();
      return;
    }
    animateClose(motion, height, onClose);
  }, [exiting, height, motion, onClose, reduceMotion]);

  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-6, 6])
        .onUpdate((event) => {
          if (isExiting(exiting)) {
            return;
          }
          followFinger(motion, event.translationY);
        })
        .onEnd((event) => {
          if (isExiting(exiting)) {
            return;
          }
          if (event.translationY > height * DISMISS_RATIO || event.velocityY > DISMISS_VELOCITY) {
            runOnJS(close)();
            return;
          }
          springBack(motion);
        }),
    [close, exiting, height, motion],
  );

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: motion.offset.value }],
  }));

  return { panelStyle, onLayout, close, dragGesture };
}
