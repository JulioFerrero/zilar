import { useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

/**
 * `Pressable`'s function `style` is dropped when combined with NativeWind's
 * `className`, so keys drive pressed state through `onPressIn`/`onPressOut`.
 */
export function useKeyPress() {
  const reduceMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  return { pressed, reduceMotion, setPressed };
}
