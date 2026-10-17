import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, type LayoutChangeEvent } from 'react-native';
import {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

const OPEN_MS = 260;
const CLOSE_MS = 200;
const EASING = Easing.bezier(0.32, 0.72, 0, 1);
const WINDOW_HEIGHT = Dimensions.get('window').height;

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

/**
 * The phone sheets' motion (T-1922): the panel slides up from the bottom in
 * 260 ms when the sheet mounts and back down in 200 ms before it closes, so
 * enter and exit take the same path as the kit `BottomSheet`. `close` is
 * idempotent while the exit runs. With reduced motion the panel never
 * translates: it just fades with the `Modal`, and `close` calls `onClose`
 * at once. Call this from a body that mounts only while the sheet is open.
 */
export function useSheetMotion(onClose: () => void) {
  const reduceMotion = useReducedMotion();
  const offset = useSharedValue(reduceMotion ? 0 : WINDOW_HEIGHT);
  // A plain object so the animations write the shared value outside render.
  const motion = useMemo<SheetMotionValues>(() => ({ offset }), [offset]);
  const [height, setHeight] = useState(WINDOW_HEIGHT);
  const measured = useRef(false);
  const closing = useRef(false);

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
    if (closing.current) {
      return;
    }
    closing.current = true;
    if (reduceMotion) {
      onClose();
      return;
    }
    animateClose(motion, height, onClose);
  }, [height, motion, onClose, reduceMotion]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: motion.offset.value }],
  }));

  return { panelStyle, onLayout, close };
}
