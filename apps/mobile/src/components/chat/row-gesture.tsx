import { Effect } from 'effect';
import * as Haptics from 'expo-haptics';
import { Reply } from 'lucide-react-native';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

const REPLY_THRESHOLD = 60;
const MAX_TRANSLATE_X = 96;
// The same stiff close as the old swipeable, so a short swipe snaps back
// without wobbling the row.
const SPRING_BACK = { damping: 1000, stiffness: 700, overshootClamping: true } as const;

// A failed haptic is ignored: the swipe or the reaction still works without it.
function lightHaptic(): void {
  Effect.runFork(
    Effect.tryPromise(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).pipe(
      Effect.ignore,
    ),
  );
}

/**
 * The row's swipe: a rightward drag moves one shared value up to 96 px, past
 * 60 px it replies on release, and it always springs back.
 */
function makePan(
  enabled: boolean,
  translateX: SharedValue<number>,
  fireReply: () => void,
): PanGesture {
  return (
    Gesture.Pan()
      .enabled(enabled)
      // One value sets only the activation distance, so the pan starts after a
      // 12 px rightward drag; the array form would set a start threshold and
      // activate at rest.
      .activeOffsetX(12)
      .failOffsetY([-10, 10])
      .onUpdate((event) => {
        translateX.value = Math.min(Math.max(event.translationX, 0), MAX_TRANSLATE_X);
      })
      .onEnd((_event, success) => {
        if (success && translateX.value >= REPLY_THRESHOLD) {
          runOnJS(fireReply)();
        }
      })
      .onFinalize(() => {
        translateX.value = withSpring(0, SPRING_BACK);
      })
  );
}

// A stable callback (like `useStableIndexChange` in folder-pager.tsx): the pan
// keeps its identity across renders while it still calls this render's reply.
function useStableVoidCallback(callback: () => void): () => void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);
  return useMemo(() => () => latest.current(), []);
}

// The bubble's double-tap lives in its own detector (bubble-gesture.tsx) but
// must not cancel the row's swipe, so it finds the pan here and runs beside it.
const RowPanContext = createContext<PanGesture | null>(null);

/** The enclosing row's swipe, or null when the bubble is used on its own. */
export function useRowPan(): PanGesture | null {
  return useContext(RowPanContext);
}

type RowGestureProps = {
  /** The colour of the reply arrow revealed by a right swipe. */
  color: string;
  onReply: () => void;
  /** False while the row is in select mode. */
  swipeEnabled?: boolean;
  children: ReactNode;
};

/**
 * W3b (T-2022): the row's swipe-to-reply without the `ReanimatedSwipeable`
 * (nine shared values, four animated styles and its own pan per row). One pan
 * drives one shared value:
 *
 * - it only starts on a rightward drag (`activeOffsetX`) and fails at once on
 *   vertical movement (`failOffsetY`), so a list fling never swipes a row;
 * - the shared value moves the row up to 96 px and fades in the reply arrow
 *   past `REPLY_THRESHOLD`; releasing past it fires a Light haptic and replies,
 *   and the row always springs back.
 *
 * The double-tap-to-react stays on the bubble itself (`BubbleGesture`) so a tap
 * on an avatar or a reaction chip is not swallowed by it; that tap runs
 * simultaneously with this pan through `useRowPan`.
 */
export function RowGesture({ color, onReply, swipeEnabled = true, children }: RowGestureProps) {
  const translateX = useSharedValue(0);
  // The pan keeps its identity across renders: it reads the reply callback
  // through a stable function, so a re-render does not rebuild the gesture.
  const fireReply = useStableVoidCallback(() => {
    lightHaptic();
    onReply();
  });

  const pan = useMemo(
    () => makePan(swipeEnabled, translateX, fireReply),
    [fireReply, swipeEnabled, translateX],
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const replyStyle = useAnimatedStyle(() => {
    const value = Math.min(translateX.value / REPLY_THRESHOLD, 1);
    return { opacity: value, transform: [{ scale: 0.7 + 0.3 * value }] };
  });

  return (
    <RowPanContext.Provider value={pan}>
      <GestureDetector gesture={pan}>
        <View style={{ overflow: 'hidden' }}>
          <Animated.View
            pointerEvents="none"
            style={[
              replyStyle,
              {
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: 72,
                alignItems: 'center',
                justifyContent: 'center',
              },
            ]}
          >
            <Reply size={22} color={color} />
          </Animated.View>
          <Animated.View style={rowStyle}>{children}</Animated.View>
        </View>
      </GestureDetector>
    </RowPanContext.Provider>
  );
}
