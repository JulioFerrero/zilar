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

/** A drag past this many pixels commits to the next/previous page. */
const COMMIT_DISTANCE = 60;
/** A flick faster than this commits even under the distance. */
const COMMIT_VELOCITY = 500;
/** How far the track follows a drag past the first/last page. */
const EDGE_RESISTANCE = 0.35;
/** The settle animation of one page step. */
const SETTLE_MS = 240;

/** The shared values the pager reads and writes, held in one plain object. */
export type PagerMotion = {
  translateX: SharedValue<number>;
  startX: SharedValue<number>;
  /** The continuous page position, shared with the tabs. */
  progress: SharedValue<number>;
};

/**
 * Animates the track and the tabs' indicator to a page. A worklet: the pan
 * callbacks run on the UI thread and call it there; it is also called from the
 * JS-side effect, which runs the worklet on the JS thread.
 */
export function animateToPage(motion: PagerMotion, page: number, width: number): void {
  'worklet';
  motion.translateX.value = withTiming(-page * width, { duration: SETTLE_MS });
  motion.progress.value = withTiming(page, { duration: SETTLE_MS });
}

/**
 * The pan that pages: a clean horizontal drag moves the track (with resistance
 * past the first/last page); on release past a distance or flick it settles on
 * the next/previous page and reports it. A cancelled or failed drag settles on
 * the nearest page instead (see `onFinalize`), so the track never stays stranded
 * between pages. A vertical drag fails the pan so the list keeps its scroll, and
 * a still touch leaves taps and long-presses alone.
 */
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
        // A cancelled or failed drag is settled by `onFinalize`.
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
      // The drag was cancelled or failed mid-way (for example a system
      // interruption) without `onEnd` settling it, so snap to the nearest page:
      // the track and the tabs must never stay stranded between pages. No page is
      // reported, a cancel never changes the settled folder.
      const target = Math.max(0, Math.min(count - 1, Math.round(-motion.translateX.value / width)));
      animateToPage(motion, target, width);
    });
}

/**
 * Keeps a callback's identity stable while it always calls the latest closure:
 * the screen hands a fresh `onIndexChange` each render, and the pager must not
 * rebuild its pan for it. The same pattern as `useStableHandler` in
 * `use-stable-handlers.ts`.
 */
function useStableIndexChange(onIndexChange: (index: number) => void): (index: number) => void {
  const latest = useRef(onIndexChange);
  useEffect(() => {
    latest.current = onIndexChange;
  });
  return useMemo(() => (index: number) => latest.current(index), []);
}

type FolderPagerProps = {
  /** How many pages (the folders, "All chats" included). */
  count: number;
  /** The settled page; the pager animates to it when it changes from outside. */
  index: number;
  /** The continuous page position, shared with the tabs so the indicator follows. */
  progress: SharedValue<number>;
  /** Called with the new page once a swipe settles on another one. */
  onIndexChange: (index: number) => void;
  /** Renders one page; only the visible page and its neighbours are asked. */
  renderPage: (index: number) => ReactNode;
};

/**
 * The horizontal folder pager (T-1310) on `react-native-gesture-handler` plus
 * `react-native-reanimated`, both already in `apps/mobile/package.json` (no new
 * dependency). One page per folder slides under the tabs; only the visible page
 * and its immediate neighbours render their lists. The `progress` shared value
 * carries the continuous page position to the tabs on the UI thread.
 */
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
  // A plain object so the worklets and the settle effect read and write the
  // shared values through it; its members are stable across renders.
  const motion = useMemo<PagerMotion>(
    () => ({ translateX, startX, progress }),
    [translateX, startX, progress],
  );

  useEffect(() => {
    animateToPage(motion, index, width);
    // `motion` holds the shared values, which keep their identity; only the
    // settled index moves the pager from the outside.
  }, [index, width, motion]);

  // The pager keeps one pan across renders: rebuilding it mid-drag would drop
  // the in-flight gesture and strand the track between pages. `onIndexChange`
  // comes in fresh each render (it closes over the screen's state), so the pan
  // reads the latest one through a stable callback instead of depending on it.
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
