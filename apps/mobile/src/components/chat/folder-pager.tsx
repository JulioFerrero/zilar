import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

const COMMIT_DISTANCE = 60;
const COMMIT_VELOCITY = 500;
const EDGE_RESISTANCE = 0.35;
const SETTLE_MS = 240;

export type PagerMotion = {
  translateX: SharedValue<number>;
  startX: SharedValue<number>;
  progress: SharedValue<number>;
};

export function animateToPage(motion: PagerMotion, page: number, width: number): void {
  'worklet';
  motion.translateX.value = withTiming(-page * width, { duration: SETTLE_MS });
  motion.progress.value = withTiming(page, { duration: SETTLE_MS });
}

/** On release past the distance or flick it settles on the next page and
 *  reports it; a cancelled drag snaps to the nearest page, never stranded. */
function makePan(
  motion: PagerMotion,
  count: number,
  width: number,
  onIndexChange: (index: number) => void,
) {
  return Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onStart(() => {
      motion.startX.value = motion.translateX.value;
    })
    .onUpdate((event) => {
      const min = -(count - 1) * width;
      const raw = motion.startX.value + event.translationX;
      if (raw > 0) {
        motion.translateX.value = raw * EDGE_RESISTANCE;
      } else if (raw < min) {
        motion.translateX.value = min + (raw - min) * EDGE_RESISTANCE;
      } else {
        motion.translateX.value = raw;
      }
      motion.progress.value = -motion.translateX.value / width;
    })
    .onEnd((event, success) => {
      if (!success) {
        return;
      }
      const base = Math.round(-motion.startX.value / width);
      let target = base;
      if (event.translationX < -COMMIT_DISTANCE || event.velocityX < -COMMIT_VELOCITY) {
        target = base + 1;
      } else if (event.translationX > COMMIT_DISTANCE || event.velocityX > COMMIT_VELOCITY) {
        target = base - 1;
      }
      target = Math.max(0, Math.min(count - 1, target));
      animateToPage(motion, target, width);
      if (target !== base) {
        runOnJS(onIndexChange)(target);
      }
    })
    .onFinalize((_event, success) => {
      if (success) {
        return;
      }
      // A cancelled or failed drag snaps to the nearest page: the track and the tabs
      // must never stay stranded between pages.
      const target = Math.max(0, Math.min(count - 1, Math.round(-motion.translateX.value / width)));
      animateToPage(motion, target, width);
    });
}

/** Keeps a callback's identity stable while it always calls the latest closure. */
function useStableIndexChange(onIndexChange: (index: number) => void): (index: number) => void {
  const latest = useRef(onIndexChange);
  useEffect(() => {
    latest.current = onIndexChange;
  });
  return useMemo(() => (index: number) => latest.current(index), []);
}

type FolderPagerProps = {
  count: number;
  index: number;
  progress: SharedValue<number>;
  onIndexChange: (index: number) => void;
  renderPage: (index: number) => ReactNode;
};

/** Only the visible page and its immediate neighbours render their lists. */
export function FolderPager({
  count,
  index,
  progress,
  onIndexChange,
  renderPage,
}: FolderPagerProps) {
  const { width } = useWindowDimensions();
  const translateX = useSharedValue(-index * width);
  const startX = useSharedValue(-index * width);
  // A plain object so worklets read and write the shared values through it.
  const motion = useMemo<PagerMotion>(
    () => ({ translateX, startX, progress }),
    [translateX, startX, progress],
  );

  useEffect(() => {
    animateToPage(motion, index, width);
    // Rebuilding the pan mid-drag would drop the gesture, so it reads the latest
    // `onIndexChange` through a stable callback.
  }, [index, width, motion]);

  const handleIndexChange = useStableIndexChange(onIndexChange);

  const pan = useMemo(
    () => makePan(motion, count, width, handleIndexChange),
    [motion, count, width, handleIndexChange],
  );
  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: motion.translateX.value }],
  }));

  const first = Math.max(0, index - 1);
  const last = Math.min(count - 1, index + 1);
  const pages: ReactNode[] = [];
  for (let page = first; page <= last; page += 1) {
    pages.push(
      <Animated.View
        key={page}
        style={{ position: 'absolute', top: 0, bottom: 0, left: page * width, width }}
      >
        {renderPage(page)}
      </Animated.View>,
    );
  }

  return (
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <Animated.View style={[{ flex: 1, width: count * width }, trackStyle]}>
          {pages}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
