import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { cn } from '@/lib/utils';

/** Three animated dots for `typing…` and `AI · working…`. */
export function TypingDots({ color, className }: { color: string; className?: string }) {
  const reduceMotion = useReducedMotion();
  const [first] = useState(() => new Animated.Value(0.3));
  const [second] = useState(() => new Animated.Value(0.3));
  const [third] = useState(() => new Animated.Value(0.3));

  useEffect(() => {
    if (reduceMotion) {
      first.setValue(0.6);
      second.setValue(0.6);
      third.setValue(0.6);
      return;
    }
    const bounce = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0.3, duration: 300, useNativeDriver: true }),
        ]),
      );
    const animations = [bounce(first, 0), bounce(second, 200), bounce(third, 400)];
    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [first, second, third, reduceMotion]);

  return (
    <View className={cn('flex-row items-center gap-0.5', className)} accessible={false}>
      {[first, second, third].map((value, index) => (
        <Animated.View
          key={index}
          style={{
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: color,
            opacity: value,
          }}
        />
      ))}
    </View>
  );
}

/** The single pulsing dot that marks `writing…` in the chat list (ui-style.md §5). */
export function PulseDot({
  color,
  size = 6,
  className,
}: {
  color: string;
  size?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [value] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduceMotion) {
      value.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(value, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, value]);

  return (
    <Animated.View
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: value,
      }}
    />
  );
}
