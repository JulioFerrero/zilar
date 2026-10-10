import { Effect } from 'effect';
import { getIntegrationsStatus, type IntegrationsStatus } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { useAction, type ActionState } from '@/lib/effect/use-action';

/** What a card hands the shared save machine for its own setting. */
export interface IntegrationSave<Op, Value, ValidationError> {
  /** The write call; the card trims and shapes its payload before this. */
  write: (op: Op) => Promise<void>;
  /** The card's own check, run before anything is sent. */
  validate?: (op: Op) => ValidationError | undefined;
  /** Empties the card's secret field once the write stuck. */
  clearInput?: (op: Op) => void;
  /** Patches the page from the reloaded status (the card picks its slice). */
  onSaved: (next: IntegrationsStatus, op: Op) => void;
  /** The value a success resolves to. */
  value: (op: Op) => Value;
}

/**
 * The one save/remove skeleton behind the Email, Voice transcription and
 * Telegram cards (T-1000): check the input, run the write, empty the secret,
 * reload the status and patch the page from it, then resolve the card's
 * value. The reload is part of the action, so a failed reload fails the
 * action and the success line never lies.
 */
export function useIntegrationSave<Op, Value, ValidationError>(
  save: IntegrationSave<Op, Value, ValidationError>,
): readonly [state: ActionState<Value, ValidationError | ApiFailure>, run: (op: Op) => void] {
  const [state, run] = useAction<Op, Value, ValidationError | ApiFailure>(
    (op): Effect.Effect<Value, ValidationError | ApiFailure> => {
      const invalid = save.validate?.(op);
      if (invalid !== undefined) {
        return Effect.fail(invalid);
      }
      return fromApi(() => save.write(op)).pipe(
        Effect.tap(() => Effect.sync(() => save.clearInput?.(op))),
        Effect.andThen(fromApi(() => getIntegrationsStatus())),
        Effect.tap((next) => Effect.sync(() => save.onSaved(next, op))),
        Effect.as(save.value(op)),
      );
    },
  );
  return [state, run];
}
