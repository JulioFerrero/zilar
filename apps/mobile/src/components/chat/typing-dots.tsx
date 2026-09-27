import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';

import { cn } from '@/lib/utils';

/** Three animated dots for `typing…` and `AI · working…`. */
export function TypingDots({ color, className }: { color: string; className?: string }) {
  const [first] = useState(() => new Animated.Value(0.3));
  const [second] = useState(() => new Animated.Value(0.3));
  const [third] = useState(() => new Animated.Value(0.3));

  useEffect(() => {
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
  }, [first, second, third]);

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
