import { formatTime, type UiMessage } from '@zilar/chat-core';
import { useEffect, useState } from 'react';
import { Animated, AppState, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Ticks } from '@/components/chat/ticks';
import { PulseDot } from '@/components/chat/typing-dots';
import { Text } from '@/components/ui/text';
import { raisedPill } from '@/lib/depth';
import type { ActiveSource } from '@/lib/use-smooth-text';
import { cn } from '@/lib/utils';

export const TAIL_WIDTH = 9;
export const TAIL_HEIGHT = 12;
export const LONG_PRESS_MS = 350;
// Mirrors `--generating-foreground` in `src/global.css` (the bubble text while
// the AI is still writing).
export const GENERATING_FOREGROUND = '#8f8f8f';
const CARET_COLOR = '#bdbdbd';
// The recessed generating look fades into the incoming look over this long.
export const SWAP_MS = 400;

// The bubble follows the app's foreground state so a reply that arrives while
// the app was backgrounded snaps to its latest text instead of replaying.
export const appActiveSource: ActiveSource = {
  subscribe: (onActive) => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        onActive();
      }
    });
    return () => subscription.remove();
  },
};

export function BubbleTail({ outgoing, color }: { outgoing: boolean; color: string }) {
  return (
    <Svg
      width={TAIL_WIDTH}
      height={TAIL_HEIGHT}
      viewBox={`0 0 ${TAIL_WIDTH} ${TAIL_HEIGHT}`}
      style={
        outgoing
          ? { position: 'absolute', right: -8, bottom: 0 }
          : { position: 'absolute', left: -8, bottom: 0, transform: [{ scaleX: -1 }] }
      }
    >
      <Path
        d={`M0 0 C0.5 6.5 2.5 9.5 ${TAIL_WIDTH} ${TAIL_HEIGHT} L0 ${TAIL_HEIGHT} Z`}
        fill={color}
      />
    </Svg>
  );
}

export function BubbleMeta({
  message,
  outgoing,
  color,
  className,
}: {
  message: UiMessage;
  outgoing: boolean;
  color: string;
  className?: string;
}) {
  return (
    <View className={cn('flex-row items-center gap-1', className)}>
      <Text className="font-mono text-[10px]" color={color}>
        {formatTime(message.createdAt)}
      </Text>
      {outgoing && message.status === 'failed' ? (
        <Text className="font-mono text-[10px]" color={color}>
          Not sent
        </Text>
      ) : null}
      {outgoing ? <Ticks status={message.status} color={color} size={13} /> : null}
    </View>
  );
}

/** A soft blinking caret at the end of a live draft (no blink with reduced motion). */
export function DraftCaret({ reduceMotion }: { reduceMotion: boolean }) {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion]);
  return (
    <Animated.Text style={{ color: CARET_COLOR, opacity }} accessible={false}>
      ▍
    </Animated.Text>
  );
}

/** The recessed `generating` label under a reply that is still being written. */
export function GeneratingLabel() {
  return (
    <View className="mt-1 flex-row items-center gap-1.5">
      <PulseDot color={GENERATING_FOREGROUND} size={5} />
      <Text className="font-mono text-[11px]" color={GENERATING_FOREGROUND}>
        generating
      </Text>
    </View>
  );
}

export function BigEmoji({
  message,
  text,
  outgoing,
  generating,
  reduceMotion,
  onLongPress,
}: {
  message: UiMessage;
  text: string;
  outgoing: boolean;
  generating: boolean;
  reduceMotion: boolean;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      className={cn('flex-col', outgoing ? 'items-end' : 'items-start')}
    >
      <Text
        className="px-2 py-1 text-[48px] leading-none text-foreground"
        {...(generating ? { color: GENERATING_FOREGROUND } : {})}
      >
        {text}
        {generating ? <DraftCaret reduceMotion={reduceMotion} /> : null}
      </Text>
      <View
        className="mt-1 flex-row items-center gap-1 self-center rounded-full px-2 py-0.5"
        style={raisedPill}
      >
        <Text className="font-mono text-[10px] text-muted-foreground">
          {message.edited === true ? 'edited ' : ''}
          {formatTime(message.createdAt)}
        </Text>
        {outgoing ? <Ticks status={message.status} color="#8a8a8a" size={13} /> : null}
      </View>
    </Pressable>
  );
}
