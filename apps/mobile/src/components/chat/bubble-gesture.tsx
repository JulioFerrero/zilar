import { QUICK_REACTIONS, type UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';
import * as Haptics from 'expo-haptics';
import { useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

// A failed haptic is ignored: the reaction itself still toggles without it.
function lightHaptic(): void {
  Effect.runFork(
    Effect.tryPromise(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).pipe(
      Effect.ignore,
    ),
  );
}

type BubbleGestureProps = {
  message: UiMessage;
  /** The bubble's react handler; absent disables the double-tap. */
  onReact?: ((message: UiMessage, emoji: string) => void) | undefined;
  /** False for a message that cannot be reacted to yet, or in select mode. */
  enabled?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * Wraps a bubble with the T-1302 double-tap-to-react (MUX-21): two quick taps
 * add the first quick reaction, or remove it when I already reacted with it
 * (the core's `react` toggles), with a Light haptic. A plain `Tap` beside the
 * bubble's own long-press, so the long-press still opens the menu; the
 * gesture is disabled while the bubble has no wire id (a draft, or still
 * sending/failed) and in select mode. A single tap or a long press never
 * triggers it.
 */
export function BubbleGesture({
  message,
  onReact,
  enabled = true,
  className,
  children,
}: BubbleGestureProps) {
  const canReact =
    onReact !== undefined && enabled && message.status !== 'sending' && message.status !== 'failed';
  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .enabled(canReact)
        .runOnJS(true)
        .onEnd(() => {
          lightHaptic();
          onReact?.(message, QUICK_REACTIONS[0]);
        }),
    [canReact, message, onReact],
  );
  return (
    <GestureDetector gesture={doubleTap}>
      <View className={className}>{children}</View>
    </GestureDetector>
  );
}
