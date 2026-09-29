import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { cn } from '@/lib/utils';

/**
 * Quiet loading placeholders in the shape of the content they replace (T-0067).
 * `SKELETON_DELAY_MS` hides a load that finishes quickly: showing a skeleton for
 * one frame and then removing it is worse than a beat of blank.
 */
export const SKELETON_DELAY_MS = 250;

/**
 * True once the delay has passed. A load that settles sooner unmounts the
 * skeleton before it paints, so a fast load never flashes.
 */
export function useDelayedVisible(delayMs = SKELETON_DELAY_MS): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  return visible;
}

/** A slow opacity pulse, static when the OS asks for reduced motion (§6). */
function useSkeletonPulse(): Animated.Value {
  const reduceMotion = useReducedMotion();
  const [value] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduceMotion) {
      value.setValue(0.6);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(value, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, value]);

  return value;
}

function SkeletonBar() {
  return <View className="h-4 w-2/5 rounded-full bg-surface-raised" />;
}

function ChatSkeletonRow({ pulse }: { pulse: Animated.Value }) {
  return (
    <Animated.View style={{ opacity: pulse }} className="h-[76px] flex-row items-center pl-4">
      <View className="h-[52px] w-[52px] rounded-full bg-surface-raised" />
      <View className="ml-3 h-full flex-1 justify-center gap-2 border-b border-[#1a1a1a] pr-4">
        <SkeletonBar />
        <View className="h-3.5 w-4/5 rounded-full bg-surface-raised" />
      </View>
    </Animated.View>
  );
}

/** Six chat rows in the list's own layout: 52 px avatar, name bar, preview bar. */
export function ChatListSkeleton({ rows = 6 }: { rows?: number }) {
  const visible = useDelayedVisible();
  const pulse = useSkeletonPulse();

  return (
    <View
      accessible
      accessibilityLabel="Loading chats"
      accessibilityLiveRegion="polite"
      className="pt-1"
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {visible
          ? Array.from({ length: rows }, (_, index) => (
              <ChatSkeletonRow key={index} pulse={pulse} />
            ))
          : null}
      </View>
    </View>
  );
}

const MESSAGE_ROWS = [
  { width: '68%' as const, outgoing: false },
  { width: '48%' as const, outgoing: true },
  { width: '75%' as const, outgoing: false },
  { width: '42%' as const, outgoing: true },
  { width: '60%' as const, outgoing: false },
];

/** Bubble-shaped placeholders, alternating sides, on the chat background. */
export function MessageListSkeleton() {
  const visible = useDelayedVisible();
  const pulse = useSkeletonPulse();

  return (
    <View
      accessible
      accessibilityLabel="Loading messages"
      accessibilityLiveRegion="polite"
      className="flex-1"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="gap-2 px-3 pt-3"
      >
        {visible
          ? MESSAGE_ROWS.map((row, index) => (
              <Animated.View
                key={index}
                style={{ opacity: pulse, width: row.width }}
                className={cn(
                  'h-12 rounded-[14px] bg-surface-raised',
                  row.outgoing ? 'self-end' : 'self-start',
                )}
              />
            ))
          : null}
      </View>
    </View>
  );
}
