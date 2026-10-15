import { topicActivityView, type TopicAiActivity } from '@zilar/chat-core';
import { palette } from '@zilar/ui-tokens';
import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import { FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';

/** How many AI pictures a mark group shows before the "+N". */
const MAX_MARKS = 3;
/** The gap between the picture and its ring: a 20 px picture gets a 26 px ring. */
const RING_GAP = 6;
/** One slow full turn of a working AI's ring. */
const SPIN_MS = 2400;
const AMBER = '#f59e0b';
const GREEN = '#22c55e';
const TICK = '#0a0a0a';

/** The `EntityAvatar` person one activity entry is drawn from. */
function personOf(entry: TopicAiActivity) {
  return {
    id: entry.aiId,
    name: entry.name,
    ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
  };
}

/** The dashed ring a working AI wears, turning unless reduce-motion is on. */
function WorkingRing({ size }: { size: number }) {
  const reduceMotion = useReducedMotion();
  const [spin] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduceMotion) {
      spin.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: SPIN_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [reduceMotion, spin]);

  const ring = size + RING_GAP;
  const radius = ring / 2 - 1.3;
  const circumference = 2 * Math.PI * radius;
  const offset = -(ring - size) / 2;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: offset,
        top: offset,
        width: ring,
        height: ring,
        transform: [{ rotate }],
      }}
    >
      <Svg width={ring} height={ring} viewBox={`0 0 ${ring} ${ring}`} fill="none">
        <Circle
          cx={ring / 2}
          cy={ring / 2}
          r={radius}
          stroke={FOREGROUND}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeDasharray={`${Math.round(circumference * 0.66)} ${Math.round(circumference * 0.34)}`}
        />
      </Svg>
    </Animated.View>
  );
}

/** The 16 px green check a finished AI or a done topic shows. */
export function DoneCheck({ size = 16 }: { size?: number }) {
  return (
    <View accessibilityRole="image" accessibilityLabel="Done">
      <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <Circle cx={8} cy={8} r={7} fill={GREEN} />
        <Path
          d="M4.9 8.3l2.1 2.1 4.1-4.5"
          stroke={TICK}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

/** One AI's picture with its state mark: a turning ring, an amber dot or a check. */
export function AiActivityMark({
  entry,
  size = 20,
  ringColor = palette.panel,
}: {
  entry: TopicAiActivity;
  size?: number;
  /** The colour the marks ring themselves in: the surface behind the picture. */
  ringColor?: string;
}) {
  return (
    <View className="relative shrink-0" style={{ width: size, height: size }}>
      <EntityAvatar person={personOf(entry)} size={size} ai />
      {entry.state === 'working' ? <WorkingRing size={size} /> : null}
      {entry.state === 'waiting' ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: 12,
            height: 12,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: ringColor,
            backgroundColor: AMBER,
          }}
        />
      ) : null}
      {entry.state === 'done' ? (
        <View
          className="absolute rounded-full"
          style={{ right: -4, bottom: -4, borderWidth: 2, borderColor: ringColor }}
        >
          <DoneCheck />
        </View>
      ) : null}
    </View>
  );
}

/**
 * A topic's AIs at work (T-1539), shared by the topic row and the "AIs here"
 * key: up to three overlapping pictures, working (turning ring) before waiting
 * (amber dot), then "+N". A finished topic shows the green check instead; an
 * idle topic shows nothing.
 */
export function AiActivityMarks({
  activity,
  doneAt,
  ringColor = palette.panel,
  className,
}: {
  activity: readonly TopicAiActivity[];
  doneAt: string | null;
  /** The colour the marks ring themselves in; match the surface behind them. */
  ringColor?: string;
  className?: string;
}) {
  const view = topicActivityView(activity, doneAt);
  if (view.done) {
    return <DoneCheck />;
  }
  if (view.active.length === 0) {
    return null;
  }
  const shown = view.active.slice(0, MAX_MARKS);
  const extra = view.active.length - shown.length;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={view.label}
      className={cn('flex-row items-center', className)}
    >
      {shown.map((entry, index) => (
        <View key={entry.aiId} style={index > 0 ? { marginLeft: -6 } : undefined}>
          <AiActivityMark entry={entry} size={20} ringColor={ringColor} />
        </View>
      ))}
      {extra > 0 ? (
        <Text className="ml-1 text-[11px] leading-4 text-subtle-foreground">+{extra}</Text>
      ) : null}
    </View>
  );
}
