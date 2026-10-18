import { Effect } from 'effect';
import { getIntegrationsStatus, type IntegrationsStatus } from '@/lib/api';
import { fromApi, type ApiFailure } from '@zilar/client-core';
import { useAction, type ActionState } from '@/lib/effect/use-action';

export interface IntegrationSave<Op, Value, ValidationError> {
  write: (op: Op) => Promise<void>;
  validate?: (op: Op) => ValidationError | undefined;
  clearInput?: (op: Op) => void;
  onSaved: (next: IntegrationsStatus, op: Op) => void;
  value: (op: Op) => Value;
}

/**
 * Check the input, run the write, empty the secret, reload the status and
 * patch the page, then resolve the card's value. The reload is part of the
 * action, so a failed reload fails the action and the success line never lies.
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
