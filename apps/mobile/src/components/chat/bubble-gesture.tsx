import { QUICK_REACTIONS, type UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';
import * as Haptics from 'expo-haptics';
import { useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector, type TapGesture } from 'react-native-gesture-handler';

import { useRowPan } from '@/components/chat/row-gesture';

function lightHaptic(): void {
  Effect.runFork(
    Effect.tryPromise(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).pipe(
      Effect.ignore,
    ),
  );
}

type BubbleGestureProps = {
  message: UiMessage;
  onReact?: ((message: UiMessage, emoji: string) => void) | undefined;
  enabled?: boolean;
  className?: string;
  children: ReactNode;
};

/** The tap is linked to the row's swipe pan so both run; a swipe still replies. */
export function BubbleGesture({
  message,
  onReact,
  enabled = true,
  className,
  children,
}: BubbleGestureProps) {
  const rowPan = useRowPan();
  const canReact =
    onReact !== undefined && enabled && message.status !== 'sending' && message.status !== 'failed';
  const doubleTap = useMemo(() => {
    const tap: TapGesture = Gesture.Tap()
      .numberOfTaps(2)
      .enabled(canReact)
      .runOnJS(true)
      .onEnd(() => {
        lightHaptic();
        onReact?.(message, QUICK_REACTIONS[0]);
      });
    return rowPan === null ? tap : tap.simultaneousWithExternalGesture(rowPan);
  }, [canReact, message, onReact, rowPan]);
  return (
    <GestureDetector gesture={doubleTap}>
      <View className={className}>{children}</View>
    </GestureDetector>
  );
}
