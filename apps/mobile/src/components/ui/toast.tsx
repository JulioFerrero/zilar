import { useEffect } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { interruptFiber, runLater } from '@/lib/effect/timers';
import { cn } from '@/lib/utils';

/** How long one transient message stays on screen. */
export const TOAST_DURATION_MS = 3000;

export interface ToastMessage {
  /** A new id per show, so the timer restarts even for an identical text. */
  id: number;
  text: string;
  tone?: 'error' | 'notice';
}

/**
 * One transient message over the content (MUX-32): a new message replaces the
 * current one and restarts the timer, and it clears itself after
 * `TOAST_DURATION_MS`. Persistent connection state does not go through here.
 */
export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  const id = toast?.id;
  useEffect(() => {
    if (id === undefined) {
      return;
    }
    // A fiber sleeps for the duration; a new toast (new id) or an unmount
    // interrupts it, as `clearTimeout` did.
    const fiber = runLater(TOAST_DURATION_MS, onDismiss);
    return () => {
      interruptFiber(fiber);
    };
  }, [id, onDismiss]);

  if (toast === null) {
    return null;
  }
  const isError = toast.tone !== 'notice';
  return (
    <View pointerEvents="none" className="absolute inset-x-4 bottom-4 items-center">
      <View
        accessibilityRole={isError ? 'alert' : undefined}
        accessibilityLiveRegion="polite"
        className={cn(
          'max-w-full rounded-full px-4 py-2',
          isError ? 'bg-danger' : 'bg-surface-raised',
        )}
      >
        <Text
          className={cn(
            'text-center text-[13px] font-medium',
            isError ? 'text-white' : 'text-foreground',
          )}
        >
          {toast.text}
        </Text>
      </View>
    </View>
  );
}
