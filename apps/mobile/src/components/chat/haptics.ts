import { Effect } from 'effect';
import * as Haptics from 'expo-haptics';

/**
 * One light impact for a press that opens a menu or a sheet (MUX-22). The
 * bubbles' long-press uses it (via `openMessageMenu`), and so does a chat row's.
 * The haptic is a native call the press does not wait for; a failed haptic is
 * ignored and the press itself still works.
 */
export function tap(): void {
  Effect.runFork(
    Effect.tryPromise(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).pipe(
      Effect.ignore,
    ),
  );
}
