import { Effect } from 'effect';
import * as Haptics from 'expo-haptics';

/** The press does not wait for the native call; a failed haptic is ignored. */
export function tap(): void {
  Effect.runFork(
    Effect.tryPromise(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).pipe(
      Effect.ignore,
    ),
  );
}
