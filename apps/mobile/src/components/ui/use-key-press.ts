import { useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

/**
 * Tracks whether a key is pressed. `Pressable`'s function `style` is dropped
 * when combined with NativeWind's `className`, so keys drive their pressed
 * state through `onPressIn`/`onPressOut` and a plain style array instead.
 */
export function useKeyPress() {
  const reduceMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  return { pressed, reduceMotion, setPressed };
}
